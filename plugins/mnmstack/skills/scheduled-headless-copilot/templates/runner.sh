#!/bin/bash
# runner.sh — template runner for a scheduled headless Copilot task.
#
# The OS scheduler (launchd/cron/systemd/Task Scheduler) runs THIS script, not `copilot`
# directly, so PATH, auth, locking, logging, and the timeout are controlled and testable.
# Copy it to a per-task dir (e.g. ~/.copilot/scheduled-tasks/<task>/runner.sh), edit the
# CONFIG block, then test by hand and under a clean env:
#   env -i HOME="$HOME" PATH="/opt/homebrew/bin:/usr/bin:/bin" bash runner.sh
#
# Portable to macOS's stock bash 3.2 (no `wait -n`, no associative arrays, no `flock`).
# Schedulers invoke it as `/bin/bash runner.sh`, so no execute bit is required.

set -uo pipefail   # intentionally NOT `-e`: we capture copilot's exit code instead of aborting.

# ─────────────────────────── CONFIG — edit these ───────────────────────────
TASK_NAME="copilot-task"                            # used for the state dir + log names
REPO="$HOME/path/to/repo"                            # working dir passed to copilot via -C
STATE="$HOME/.copilot/scheduled-tasks/$TASK_NAME"    # durable logs/lock (outside the repo)
PROMPT="Describe the task as one self-contained, idempotent instruction. (UNIQUE_MARKER)"
MODEL=""                                             # e.g. "claude-opus-4.8"; empty = account default
AGENT=""                                             # e.g. "your-plugin:your-agent"; empty = none
TIMEOUT_SECS="1800"                                  # hard cap (30 min); 0 disables the timeout
EXTRA_DIRS=("$REPO")                                 # paths granted via --add-dir (besides -C)
# Optional: source secrets (chmod 600). Never hardcode tokens here.
# set -a; [ -f "$STATE/env" ] && . "$STATE/env"; set +a
# ────────────────────────────────────────────────────────────────────────────

# PATH: declare it in the plist/cron/systemd too; this is the defensive second layer.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p "$STATE" "$STATE/cli-logs"
LOG="$STATE/run.log"
log() { printf '%s  %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >>"$LOG"; }

# ── Pause guard: `touch $STATE/PAUSED` to disable without unscheduling the job. ──
if [ -f "$STATE/PAUSED" ]; then
  log "paused (found $STATE/PAUSED); exiting 0"
  exit 0
fi

# ── Single-flight lock. `mkdir` is atomic. A stale lock (dead owner) is reclaimed under a
#    second "steal" mutex so two racers that both spot the dead owner can't each recreate the
#    lock and double-run — only the steal-mutex holder ever touches $LOCK. The steal mutex is
#    itself stale-aware (one-level reclaim), so a crash mid-steal self-heals on the next run. ──
LOCK="$STATE/run.lock"
STEAL="$STATE/run.lock.steal"
take_steal() {                       # 0 = we hold the steal mutex, 1 = yield this round
  if mkdir "$STEAL" 2>/dev/null; then echo "$$" >"$STEAL/pid"; return 0; fi
  local sp; sp="$(cat "$STEAL/pid" 2>/dev/null || echo "")"
  [ -n "$sp" ] && kill -0 "$sp" 2>/dev/null && return 1     # a live racer is stealing; yield
  mv "$STEAL" "$STEAL.dead.$$" 2>/dev/null && rm -rf "$STEAL.dead.$$"   # dead holder → reclaim
  mkdir "$STEAL" 2>/dev/null && { echo "$$" >"$STEAL/pid"; return 0; }
  return 1
}
acquire_lock() {                     # 0 = acquired, 1 = yield
  if mkdir "$LOCK" 2>/dev/null; then echo "$$" >"$LOCK/pid"; return 0; fi
  local prev; prev="$(cat "$LOCK/pid" 2>/dev/null || echo "")"
  [ -n "$prev" ] && kill -0 "$prev" 2>/dev/null && return 1   # held by a live run; yield
  take_steal || return 1                                      # serialize the reclaim
  local result=1
  prev="$(cat "$LOCK/pid" 2>/dev/null || echo "")"            # re-check under the steal mutex
  if [ -n "$prev" ] && kill -0 "$prev" 2>/dev/null; then
    result=1                                                  # a live owner reappeared; yield
  else
    rm -rf "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null && { echo "$$" >"$LOCK/pid"; result=0; }
  fi
  rm -rf "$STEAL" 2>/dev/null                                 # release the steal mutex
  return "$result"
}
if ! acquire_lock; then
  log "another run in progress (or lock contended); exiting 0"
  exit 0
fi

# Rotate the log only now that we hold the lock, so a contending fire can't move the file out
# from under an active run (TOCTOU).
[ -f "$LOG" ] && [ "$(wc -c <"$LOG" 2>/dev/null || echo 0)" -gt 5242880 ] && mv -f "$LOG" "$LOG.1"

CHILD_PID=""
WD_PID=""
release_lock() { [ "$(cat "$LOCK/pid" 2>/dev/null || echo "")" = "$$" ] && rm -rf "$LOCK" 2>/dev/null; }
stop_watchdog() { [ -n "$WD_PID" ] && kill "$WD_PID" 2>/dev/null || true; }
# Stop the run's whole process group: TERM, poll up to ~10s, then KILL. Each signal is guarded by
# `kill -0` so a PID/PGID reused after a normal exit is never hit. Negative PID = the group
# created under `set -m`. (~10s < launchd's default 20s unload grace.)
stop_group() {
  local g="$1" i=0
  kill -0 "$g" 2>/dev/null || return 0
  kill -TERM -"$g" 2>/dev/null || true
  while [ "$i" -lt 10 ]; do kill -0 "$g" 2>/dev/null || return 0; sleep 1; i=$((i + 1)); done
  kill -0 "$g" 2>/dev/null && kill -KILL -"$g" 2>/dev/null || true
}
# External INT/TERM (launchctl unload, systemd stop, manual kill): stop the child group and
# CONFIRM it is gone before releasing the lock, so the next scheduled fire can't overlap a
# still-dying run. Disarm first to avoid re-entrant/double cleanup.
on_signal() {
  trap '' INT TERM EXIT
  [ -n "$CHILD_PID" ] && stop_group "$CHILD_PID"
  CHILD_PID=""
  stop_watchdog
  release_lock
  exit "${1:-143}"
}
cleanup() {                          # normal EXIT
  [ -n "$CHILD_PID" ] && stop_group "$CHILD_PID"
  stop_watchdog
  release_lock
  return 0
}
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap cleanup EXIT

# ── Preflight: copilot must resolve on the (possibly minimal) PATH. Add git/gh/node here too
#    if your task needs them. ──
command -v copilot >/dev/null 2>&1 || { log "FATAL: copilot not on PATH ($PATH)"; exit 127; }

# ── Build the argument list. ──
ARGS=(-p "$PROMPT" -C "$REPO"
      --allow-all-tools --no-ask-user --no-color --no-auto-update
      --log-dir "$STATE/cli-logs")
[ -n "$MODEL" ] && ARGS+=(--model "$MODEL")
[ -n "$AGENT" ] && ARGS+=(--agent "$AGENT")
if [ "${#EXTRA_DIRS[@]}" -gt 0 ]; then          # guard: empty array + `set -u` aborts on bash 3.2
  for d in "${EXTRA_DIRS[@]}"; do ARGS+=(--add-dir "$d"); done
fi

# ── Hard timeout. A self-contained polling watchdog enforces TIMEOUT_SECS with no external
#    dependency (stock macOS has no `timeout`). copilot is launched as its own process-group
#    leader (`set -m`), so the watchdog and the signal handlers stop the ENTIRE tree (copilot +
#    any children) via stop_group's guarded negative-PID signals — never just the top PID, and
#    never the runner itself. The watchdog self-exits within ~5s of a normal finish, so no
#    long-lived `sleep` is orphaned. ──
watchdog() {
  local left="$1" target="$2"
  while [ "$left" -gt 0 ]; do
    kill -0 "$target" 2>/dev/null || return 0     # run finished — stop watching promptly
    sleep 5; left=$((left - 5))
  done
  stop_group "$target"                            # timed out: TERM→(poll)→KILL the whole group
}

log "START task=$TASK_NAME repo=$REPO model=${MODEL:-default} agent=${AGENT:-none} timeout=${TIMEOUT_SECS}s"
rc=0
set -m                                             # each bg job gets its own process group…
copilot "${ARGS[@]}" >>"$LOG" 2>&1 &
CHILD_PID=$!                                        # …so $CHILD_PID is also the group's PGID
set +m
[ "$TIMEOUT_SECS" -gt 0 ] && { watchdog "$TIMEOUT_SECS" "$CHILD_PID" & WD_PID=$!; }
if wait "$CHILD_PID"; then rc=0; else rc=$?; fi
CHILD_PID=""
stop_watchdog

if [ "$rc" -eq 0 ]; then
  log "DONE ok"
else
  log "DONE FAILED rc=$rc (143=TERM/timed out, 137=KILL)"
fi

# Optional completion notification (macOS):
# command -v terminal-notifier >/dev/null 2>&1 && \
#   terminal-notifier -title "$TASK_NAME" -message "exit $rc" -open "file://$LOG" || true

exit "$rc"
