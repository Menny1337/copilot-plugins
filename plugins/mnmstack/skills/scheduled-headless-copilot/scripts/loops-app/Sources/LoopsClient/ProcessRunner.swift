import Foundation
#if canImport(Darwin)
import Darwin
#endif

public struct ProcessOutput: Sendable {
    public let stdout: Data
    public let stderr: Data
    public let exitCode: Int32

    public var stderrText: String {
        String(data: stderr, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}

public enum ProcessRunnerError: LocalizedError {
    case nonZeroExit(executable: String, arguments: [String], code: Int32, stderr: String)
    case timedOut(executable: String, arguments: [String], seconds: TimeInterval)

    public var errorDescription: String? {
        switch self {
        case .nonZeroExit(let executable, let arguments, let code, let stderr):
            let command = ([executable] + arguments).joined(separator: " ")
            return stderr.isEmpty ? "\(command) exited \(code)" : "\(command) exited \(code): \(stderr)"
        case .timedOut(let executable, _, let seconds):
            return "\(executable) timed out after \(Int(seconds))s"
        }
    }
}

/// A launch failure carries the executable path and the `posix_spawn` errno.
/// It is deliberately *not* a `ProcessRunnerError` so callers keep the same
/// distinction they had when `Process.run()` threw a Foundation error.
private func launchError(executable: String, code: Int32) -> Error {
    NSError(
        domain: "ProcessRunner",
        code: Int(code),
        userInfo: [NSLocalizedDescriptionKey: "failed to launch \(executable): \(String(cString: strerror(code)))"]
    )
}

public struct ProcessRunner {
    /// Thread-safe byte accumulator for pipe draining.
    private final class DataBox: @unchecked Sendable {
        private let lock = NSLock()
        private var storage = Data()
        func append(_ bytes: UnsafeRawBufferPointer) {
            lock.lock(); storage.append(contentsOf: bytes); lock.unlock()
        }
        var snapshot: Data { lock.lock(); defer { lock.unlock() }; return storage }
    }

    private final class BoolFlag: @unchecked Sendable {
        private let lock = NSLock()
        private var value = false
        func set() { lock.lock(); value = true; lock.unlock() }
        var isSet: Bool { lock.lock(); defer { lock.unlock() }; return value }
    }

    /// Thread-safe completion counter for the drainer threads. Polled from the
    /// async context instead of a blocking `DispatchGroup.wait`, which is
    /// unavailable from `async` code.
    private final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var value = 0
        func increment() { lock.lock(); value += 1; lock.unlock() }
        var count: Int { lock.lock(); defer { lock.unlock() }; return value }
    }

    /// Drains a readable pipe end on a dedicated OS thread using non-blocking
    /// `poll` + `read`. This keeps blocking I/O entirely off the Swift
    /// cooperative thread pool (so timeout polling never starves), reaches EOF
    /// naturally for well-behaved children, and — because every `poll` has a
    /// bounded timeout — always notices the stop flag within one tick. A
    /// descendant that inherited the pipe can never hold the drainer hostage:
    /// once the process group is signalled the write end closes and `read`
    /// returns EOF, and even if a rogue survivor escapes the group the stop
    /// flag ends the loop regardless. The thread *owns* the descriptor and
    /// closes it itself on exit, so the parent can proceed on a bounded budget
    /// without ever closing an fd a still-running thread might poll/read (which
    /// could otherwise race against fd reuse).
    private static func startDrainer(
        fd: Int32,
        into box: DataBox,
        stop: BoolFlag,
        done: Counter
    ) {
        let thread = Thread {
            // The drainer alone closes its fd, then signals completion. No other
            // code path touches this descriptor, so there is no close race.
            defer { close(fd); done.increment() }
            let existing = fcntl(fd, F_GETFL, 0)
            if existing != -1 { _ = fcntl(fd, F_SETFL, existing | O_NONBLOCK) }

            let capacity = 65_536
            let buffer = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: 1)
            defer { buffer.deallocate() }

            var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            drain: while true {
                if stop.isSet { break }
                pfd.revents = 0
                let ready = poll(&pfd, nfds_t(1), 50) // 50 ms tick keeps stop bounded
                if ready < 0 {
                    if errno == EINTR { continue }
                    break
                }
                if ready == 0 { continue } // timed out; re-check stop
                if (pfd.revents & Int16(POLLNVAL)) != 0 { break }
                if (pfd.revents & Int16(POLLIN | POLLHUP | POLLERR)) != 0 {
                    while true {
                        let n = read(fd, buffer, capacity)
                        if n > 0 {
                            box.append(UnsafeRawBufferPointer(start: buffer, count: n))
                        } else if n == 0 {
                            break drain // EOF: write end fully closed
                        } else {
                            if errno == EINTR { continue }
                            if errno == EAGAIN || errno == EWOULDBLOCK { break } // drained for now
                            break drain // unrecoverable error
                        }
                    }
                }
            }
        }
        thread.stackSize = 1 << 20
        thread.start()
    }

    /// Move a freshly created pipe descriptor above the standard descriptors so
    /// later `dup2`/`close` spawn actions can never collide with (and close) the
    /// child's just-mapped stdin/stdout/stderr. When the parent runs with fd
    /// 0/1/2 closed (e.g. `swift run … <&-`), `pipe()` happily hands back a
    /// standard descriptor; a subsequent `addclose` of that same number would
    /// then tear down a std fd we had just `dup2`'d for the child. Relocating
    /// every pipe end to >= 3 up front makes the action set collision-free.
    ///
    /// Returns the relocated descriptor (>= 3), the original descriptor when it
    /// was already safe, or `-1` when a stdio-range descriptor could not be
    /// duplicated (fd exhaustion / low `RLIMIT_NOFILE`). On the `-1` failure path
    /// the original fd is left open and untouched: the caller owns closing every
    /// pipe fd exactly once and must fail the launch rather than build spawn
    /// actions from an unsafe (stdio-range) descriptor.
    private static func relocateAboveStdio(_ fd: Int32) -> Int32 {
        guard fd >= 0 && fd <= STDERR_FILENO else { return fd }
        let moved = fcntl(fd, F_DUPFD, STDERR_FILENO + 1)
        guard moved >= 0 else { return -1 } // cannot relocate; caller fails safely
        close(fd)
        return moved
    }

    /// Feed stdin on a dedicated OS thread using the same bounded ownership
    /// model as the drainers: a non-blocking descriptor polled for writability,
    /// a stop flag checked every tick, and the thread *owning* and closing its
    /// own fd. This guarantees a bounded lifetime even when the reader never
    /// consumes the pipe — for instance a descendant that escaped the process
    /// group (via `setsid`) and retains the read end without reading. A blocking
    /// `write` in that situation would wedge forever after `run()` returned,
    /// leaking the thread and the write fd (an fd-reuse hazard). `F_SETNOSIGPIPE`
    /// keeps a closed reader from raising a process-fatal SIGPIPE; EPIPE is
    /// treated as "reader gone" and ends the loop cleanly.
    private static func startStdinWriter(
        fd: Int32,
        payload: Data,
        stop: BoolFlag,
        done: Counter
    ) {
        let thread = Thread {
            // The writer alone closes its fd, then signals completion. No other
            // code path touches this descriptor, so there is no close race.
            defer { close(fd); done.increment() }
            _ = fcntl(fd, F_SETNOSIGPIPE, 1)
            let existing = fcntl(fd, F_GETFL, 0)
            if existing != -1 { _ = fcntl(fd, F_SETFL, existing | O_NONBLOCK) }

            payload.withUnsafeBytes { raw in
                guard let base = raw.baseAddress, raw.count > 0 else { return }
                let total = raw.count
                var offset = 0
                var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
                write: while offset < total {
                    if stop.isSet { break }
                    pfd.revents = 0
                    let ready = poll(&pfd, nfds_t(1), 50) // 50 ms tick keeps stop bounded
                    if ready < 0 {
                        if errno == EINTR { continue }
                        break
                    }
                    if ready == 0 { continue } // not writable yet; re-check stop
                    if (pfd.revents & Int16(POLLNVAL | POLLERR | POLLHUP)) != 0 {
                        break // reader gone / error: nothing left to deliver
                    }
                    if (pfd.revents & Int16(POLLOUT)) != 0 {
                        let n = write(fd, base.advanced(by: offset), total - offset)
                        if n > 0 {
                            offset += n
                        } else if n < 0 {
                            if errno == EINTR { continue }
                            if errno == EAGAIN || errno == EWOULDBLOCK { continue }
                            break write // EPIPE or other: reader stopped reading
                        }
                    }
                }
            }
        }
        thread.stackSize = 1 << 20
        thread.start()
    }

    /// Non-blocking reap. Returns the raw wait status once the child is reaped
    /// (or already gone), or `nil` while it is still running.
    private static func reap(_ pid: pid_t) -> Int32? {
        var status: Int32 = 0
        let result = waitpid(pid, &status, WNOHANG)
        if result == pid { return status }
        if result == -1 && errno == ECHILD { return 0 } // already reaped
        return nil
    }

    /// Poll `waitpid` on a monotonic clock until the child is reaped or the
    /// deadline passes. Never blocks past `deadline`.
    private static func waitForExit(_ pid: pid_t, until deadline: DispatchTime) async -> Int32? {
        while true {
            if let status = reap(pid) { return status }
            if DispatchTime.now() >= deadline { return nil }
            try? await Task.sleep(nanoseconds: 15_000_000)
        }
    }

    /// True while at least one process remains in the group. `ESRCH` means the
    /// group is empty; `EPERM` means members exist we merely can't signal.
    private static func groupAlive(_ pgid: pid_t) -> Bool {
        if kill(-pgid, 0) == 0 { return true }
        return errno == EPERM
    }

    /// Tear down every remaining member of the child's process group so no
    /// descendant is orphaned, even when the leader already exited (via SIGTERM
    /// or normally) while a group member survives. Fully bounded on a monotonic
    /// clock: an optional polite SIGTERM window, then a SIGKILL sweep.
    private static func sweepGroup(_ pgid: pid_t, sendTermFirst: Bool) async {
        guard groupAlive(pgid) else { return }
        if sendTermFirst {
            kill(-pgid, SIGTERM)
            let deadline = DispatchTime.now() + 1.0
            while groupAlive(pgid) && DispatchTime.now() < deadline {
                try? await Task.sleep(nanoseconds: 20_000_000)
            }
        }
        if groupAlive(pgid) {
            kill(-pgid, SIGKILL)
            let deadline = DispatchTime.now() + 2.0
            while groupAlive(pgid) && DispatchTime.now() < deadline {
                try? await Task.sleep(nanoseconds: 20_000_000)
            }
        }
    }

    private static func exitCode(from status: Int32) -> Int32 {
        if (status & 0x7f) == 0 { // WIFEXITED
            return (status >> 8) & 0xff // WEXITSTATUS
        }
        let signal = status & 0x7f // WTERMSIG
        return 128 &+ signal
    }

    public static func run(
        _ executableURL: URL,
        arguments: [String],
        environment: [String: String] = ProcessInfo.processInfo.environment,
        stdin: Data? = nil,
        timeout: TimeInterval? = nil
    ) async throws -> ProcessOutput {
        try await Task.detached(priority: .utility) {
            // Parent-owned pipe ends: index 0 = read, index 1 = write.
            var outFDs: [Int32] = [-1, -1]
            var errFDs: [Int32] = [-1, -1]
            var inFDs: [Int32] = [-1, -1]
            guard pipe(&outFDs) == 0, pipe(&errFDs) == 0, pipe(&inFDs) == 0 else {
                let code = errno
                for fd in outFDs + errFDs + inFDs where fd >= 0 { close(fd) }
                throw launchError(executable: executableURL.path, code: code)
            }
            // Relocate every pipe end above the standard descriptors before we
            // build any spawn action. If a stdio-range end cannot be duplicated
            // (fd exhaustion / low RLIMIT_NOFILE), fail the launch safely: close
            // every pipe fd we still own exactly once and never build dup2/close
            // actions from an unsafe descriptor that could tear down child stdio.
            //
            // Test-only fault injection: when this env var is set we treat any
            // stdio-range pipe fd as unrelocatable, which deterministically
            // exercises the failure path without driving the process to EMFILE.
            let forceRelocationFailure = getenv("PROCESSRUNNER_FORCE_RELOCATION_FAILURE") != nil
            let rawFDs: [Int32] = [outFDs[0], outFDs[1], errFDs[0], errFDs[1], inFDs[0], inFDs[1]]
            var safeFDs: [Int32] = []
            safeFDs.reserveCapacity(rawFDs.count)
            for index in rawFDs.indices {
                let raw = rawFDs[index]
                let moved: Int32
                if forceRelocationFailure && raw >= 0 && raw <= STDERR_FILENO {
                    moved = -1
                } else {
                    moved = relocateAboveStdio(raw)
                }
                if moved < 0 {
                    // Close everything we still own, each exactly once: the ends
                    // already relocated (distinct, >= 3), plus this failed end and
                    // every not-yet-processed raw end (all still open, all
                    // distinct pipe descriptors — F_DUPFD never returned any of
                    // them, so there is no overlap and no double close).
                    for fd in safeFDs { close(fd) }
                    for fd in rawFDs[index...] { close(fd) }
                    throw launchError(executable: executableURL.path, code: EMFILE)
                }
                safeFDs.append(moved)
            }
            let outRead = safeFDs[0], outWrite = safeFDs[1]
            let errRead = safeFDs[2], errWrite = safeFDs[3]
            let inRead = safeFDs[4], inWrite = safeFDs[5]

            // File actions: wire the child's std fds and drop the parent ends.
            var fileActions: posix_spawn_file_actions_t?
            posix_spawn_file_actions_init(&fileActions)
            posix_spawn_file_actions_adddup2(&fileActions, inRead, 0)
            posix_spawn_file_actions_adddup2(&fileActions, outWrite, 1)
            posix_spawn_file_actions_adddup2(&fileActions, errWrite, 2)
            posix_spawn_file_actions_addclose(&fileActions, outRead)
            posix_spawn_file_actions_addclose(&fileActions, errRead)
            posix_spawn_file_actions_addclose(&fileActions, inWrite)

            // Own process group (kill the whole tree, not just the leader) and
            // close-on-exec by default (no stray parent descriptors leak into
            // the child or its descendants).
            var attr: posix_spawnattr_t?
            posix_spawnattr_init(&attr)
            posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT))
            posix_spawnattr_setpgroup(&attr, 0)

            var argv: [UnsafeMutablePointer<CChar>?] = ([executableURL.path] + arguments).map { strdup($0) }
            argv.append(nil)
            var envp: [UnsafeMutablePointer<CChar>?] = environment.map { strdup("\($0.key)=\($0.value)") }
            envp.append(nil)

            defer {
                posix_spawn_file_actions_destroy(&fileActions)
                posix_spawnattr_destroy(&attr)
                for p in argv where p != nil { free(p) }
                for p in envp where p != nil { free(p) }
            }

            var pid: pid_t = 0
            let spawnResult = executableURL.path.withCString { path in
                posix_spawn(&pid, path, &fileActions, &attr, argv, envp)
            }

            // Parent no longer needs the child ends regardless of outcome.
            close(inRead); close(outWrite); close(errWrite)

            guard spawnResult == 0 else {
                close(outRead); close(errRead); close(inWrite)
                throw launchError(executable: executableURL.path, code: spawnResult)
            }

            // Feed stdin off-thread with a bounded, self-owned descriptor so a
            // child (or an escaped descendant retaining the read end) that never
            // reads can't wedge the writer forever after we return. `stopStdin`
            // ends the writer within one poll tick; it then closes its own fd.
            let stopStdin = BoolFlag()
            let stdinDone = Counter()
            if let stdin {
                startStdinWriter(fd: inWrite, payload: stdin, stop: stopStdin, done: stdinDone)
            } else {
                close(inWrite) // child observes EOF immediately
            }

            let outBox = DataBox()
            let errBox = DataBox()
            let stopDrains = BoolFlag()
            let drainsDone = Counter()
            startDrainer(fd: outRead, into: outBox, stop: stopDrains, done: drainsDone)
            startDrainer(fd: errRead, into: errBox, stop: stopDrains, done: drainsDone)

            var timedOut = false
            var status: Int32 = 0

            if let timeout {
                let deadline = DispatchTime.now() + timeout
                if let reaped = await waitForExit(pid, until: deadline) {
                    status = reaped
                } else {
                    timedOut = true
                    // Graceful, whole-group SIGTERM first.
                    kill(-pid, SIGTERM)
                    if let reaped = await waitForExit(pid, until: DispatchTime.now() + 2.0) {
                        status = reaped
                    } else {
                        // Escalate to a whole-group SIGKILL; reaping stays bounded.
                        kill(-pid, SIGKILL)
                        if let reaped = await waitForExit(pid, until: DispatchTime.now() + 2.0) {
                            status = reaped
                        } else {
                            _ = reap(pid) // best-effort, never blocks
                        }
                    }
                }
            } else {
                // No timeout: wait for natural exit, responsively but unbounded.
                while true {
                    if let reaped = reap(pid) { status = reaped; break }
                    try? await Task.sleep(nanoseconds: 15_000_000)
                }
            }

            // The leader has exited (or timed out). Sweep the whole process
            // group so no descendant is orphaned: on timeout we already sent a
            // group SIGTERM, so go straight to a KILL sweep; on a normal/fast
            // exit, politely SIGTERM leftover group members first, then KILL.
            // Killing survivors also closes any pipe ends they inherited, so the
            // drainers below can reach EOF instead of stalling.
            await sweepGroup(pid, sendTermFirst: !timedOut)

            // Give the drainers a bounded window to reach EOF, then stop them
            // unconditionally. The group sweep above closes inherited write ends,
            // so EOF normally arrives at once; a rogue survivor that escaped the
            // group can only cost us the short grace, never the child's runtime.
            let grace: DispatchTimeInterval = timedOut ? .milliseconds(500) : .seconds(2)
            let graceDeadline = DispatchTime.now() + grace
            while drainsDone.count < 2 && DispatchTime.now() < graceDeadline {
                try? await Task.sleep(nanoseconds: 10_000_000)
            }
            if drainsDone.count < 2 {
                // Tell any lingering drainer to stop; it owns and closes its own
                // fd when it next wakes (within one 50 ms poll tick), so we never
                // close a descriptor out from under a running thread.
                stopDrains.set()
            }

            // Always release the stdin writer before returning. If it already
            // finished this is a no-op; if it is wedged writing to a reader that
            // never consumes (e.g. a descendant that escaped the group and keeps
            // the read end open), it stops within one poll tick and closes its
            // own fd — so no writer thread or write descriptor can outlive run().
            stopStdin.set()

            if timedOut {
                // A kill/termination failure surfaces only as timedOut and never
                // carries drained (potentially secret-bearing) output.
                throw ProcessRunnerError.timedOut(
                    executable: executableURL.path,
                    arguments: arguments,
                    seconds: timeout ?? 0
                )
            }

            return ProcessOutput(
                stdout: outBox.snapshot,
                stderr: errBox.snapshot,
                exitCode: exitCode(from: status)
            )
        }.value
    }

    public static func runOrThrow(
        _ executableURL: URL,
        arguments: [String],
        environment: [String: String] = ProcessInfo.processInfo.environment,
        stdin: Data? = nil,
        timeout: TimeInterval? = nil
    ) async throws -> ProcessOutput {
        let output = try await run(
            executableURL,
            arguments: arguments,
            environment: environment,
            stdin: stdin,
            timeout: timeout
        )
        guard output.exitCode == 0 else {
            throw ProcessRunnerError.nonZeroExit(
                executable: executableURL.path,
                arguments: arguments,
                code: output.exitCode,
                stderr: output.stderrText
            )
        }
        return output
    }
}
