"""Exercise the real Node terminal with POSIX PTYs and no external command path."""
import fcntl
import json
import os
import pathlib
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
DOWN, UP, ENTER = b"\x1b[B", b"\x1b[A", b"\r"


class Terminal:
    def __init__(self, scenario, config, columns=100, rows=30, command=None, **extra):
        self.master, self.slave = pty.openpty()
        self.before = termios.tcgetattr(self.slave)
        self.size(columns, rows)
        env = {"HOME": os.path.dirname(config), "AZURE_CONFIG_DIR": config + ".empty-azure",
               "PATH": "", "TERM": "xterm-256color", "LANG": "C.UTF-8", **extra}
        self.process = subprocess.Popen(command or [sys.argv[1], sys.argv[2], scenario, config],
                                        stdin=self.slave, stdout=self.slave, stderr=self.slave, env=env)
        self.data, self.cursor = b"", 0

    def size(self, columns, rows):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))

    def text(self):
        return ANSI.sub("", self.data.decode("utf-8", errors="replace")).replace("\r", "")

    def expect(self, value):
        end = time.monotonic() + 8
        while time.monotonic() < end:
            found = self.text().find(value, self.cursor)
            if found >= 0:
                self.cursor = found + len(value)
                return
            ready, _, _ = select.select([self.master], [], [], 0.05)
            if ready:
                self.data += os.read(self.master, 65536)
            if self.process.poll() is not None:
                break
        raise AssertionError(f"Missing {value!r} in {self.text()[-3500:]!r}")

    def send(self, value):
        os.write(self.master, value)

    def answer(self, prompt, value=ENTER):
        self.expect(prompt)
        self.send(value)

    def finish(self):
        self.expect("TEST-RESULT ")
        self.wait_exit()
        line = self.text().split("TEST-RESULT ", 1)[1].splitlines()[0]
        return json.loads(line)

    def wait_exit(self):
        self.process.wait(timeout=8)
        while select.select([self.master], [], [], 0.05)[0]:
            self.data += os.read(self.master, 65536)
        assert self.process.returncode == 0, self.text()
        after = termios.tcgetattr(self.slave)
        for flag in (termios.ICANON, termios.ECHO, termios.ISIG):
            assert (after[3] & flag) == (self.before[3] & flag), "terminal flags not restored"
        assert self.data.count(b"\x1b[?25l") == self.data.count(b"\x1b[?25h"), "cursor not restored"

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=8)
        os.close(self.master)
        os.close(self.slave)


def collect(t, resumed=False):
    if resumed:
        t.answer("Continue draft")
    else:
        t.answer("Subscription and directory")
        t.answer("Resource prefix (accept or edit)", b"edited-html-publishing\r")
    t.answer("Publisher resources")
    t.answer("Resource group: create or reuse?")
    t.answer("Resource group name")
    t.answer("Region")
    for role in ("Hosting plan", "Managed identity", "App registration", "Website"):
        t.answer(f"{role}: create or reuse?")
        t.answer(f"{role} name")
        if role == "Hosting plan":
            t.answer("Paid Linux hosting tier")
    t.answer("Reader group: create or reuse?", DOWN + ENTER)
    t.answer("Choose reader groups", b" " + DOWN + b" " + ENTER)
    t.answer("Reader group selection")
    t.answer("Choose managers", b" " + DOWN + b" " + ENTER)
    t.answer("Manager security groups", DOWN + ENTER)
    t.answer("Choose manager security groups", b" " + DOWN + b" " + ENTER)
    t.answer("Choose approved client apps", b" " + DOWN + b" " + ENTER)
    t.answer("Log workspace: create or reuse?")
    t.answer("Log workspace name")
    t.answer("Log retention days")
    t.answer("Daily log quota")
    t.expect("What next?")


case, config = sys.argv[3:5]
t = None
try:
    if case == "single":
        t = Terminal("single", config)
        t.answer("Up/Down: move.", DOWN + DOWN + UP + ENTER)
        assert t.finish() == "beta"
        assert b"\x1b[36m" in t.data
    elif case == "multiple":
        t = Terminal("multiple", config)
        t.answer("Space: toggle.", ENTER)
        t.answer("Choose at least 1.", b" ")
        t.answer("1 selected", DOWN + b" " + DOWN + b" ")
        t.answer("Choose at most 2.", UP + b" " + DOWN + b" " + ENTER)
        assert t.finish() == ["alpha", "gamma"]
    elif case in ("escape", "ctrl-c", "text-escape", "text-ctrl-c"):
        text = case.startswith("text-")
        t = Terminal("text" if text else "single", config)
        t.answer("Report name" if text else "Up/Down: move.", b"\x03" if case.endswith("ctrl-c") else b"\x1b")
        assert t.finish() == {"status": "saved"}
    elif case == "no-color":
        t = Terminal("single", config, NO_COLOR="")
        t.answer("Up/Down: move.", DOWN + ENTER)
        assert t.finish() == "beta"
        assert not re.search(rb"\x1b\[[0-9;]*m", t.data), "NO_COLOR leaked SGR"
    elif case == "dumb":
        t = Terminal("multiple", config, TERM="dumb")
        t.answer("Choice numbers", b"1,3\r")
        assert t.finish() == ["alpha", "gamma"]
        assert b"\x1b" not in t.data
    elif case == "narrow":
        t = Terminal("single", config, columns=20, rows=8)
        t.answer("Choose a target", DOWN + ENTER)
        assert t.finish() == "beta"
        assert b"\x1b[?25l" not in t.data
        assert not re.search(rb"\x1b\[[0-9]+A", t.data)
        assert all(len(line) <= 19 for line in t.text().split("TEST-RESULT")[0].splitlines())
    elif case == "resize":
        t = Terminal("single", config)
        t.expect("Up/Down: move.")
        t.size(38, 12)
        os.kill(t.process.pid, signal.SIGWINCH)
        time.sleep(0.1)
        t.send(DOWN + ENTER)
        assert t.finish() == "beta"
    elif case in ("approve", "decline"):
        t = Terminal("approval", config)
        t.answer("Type DELETE report.html to approve", b"DELETE report.html\r" if case == "approve" else ENTER)
        assert t.finish() == ("approved" if case == "approve" else {"status": "saved"})
    elif case == "wizard":
        t = Terminal("wizard", config)
        collect(t)
        # Back to review is a deliberate action, never an approval.
        t.send(DOWN + ENTER)
        t.answer("Change a setting", UP + ENTER)
        t.answer("What next?", DOWN + DOWN + ENTER)
        result = t.finish()
        assert result["status"] == "saved" and result["inventory"] is None
        answers = result["draft"]["answers"]
        assert len(answers["readerGroups"]) == len(answers["managerObjectIds"]) == len(answers["managerGroupIds"]) == len(answers["allowedClientIds"]) == 2
        assert answers["diagnostics"]["mode"] == "enabled"
        for disclosure in ("other users", "public ingestion/query", "restart", "hard spend cap"):
            assert disclosure in re.sub(r"\s+", " ", t.text()), disclosure
        assert "OFFLINE FIXTURE:" not in t.text()
    elif case == "resume":
        t = Terminal("wizard", config)
        t.answer("Subscription and directory")
        t.answer("Resource prefix (accept or edit)", b"saved-html-publishing\r")
        t.answer("Publisher resources", b"\x03")
        first = t.finish()
        assert first["draft"]["prefix"] == "saved-html-publishing"
        assert first["inventory"] is None
        t.close()
        t = Terminal("wizard", config)
        collect(t, resumed=True)
        t.send(b"\x1b")
        assert t.finish()["status"] == "saved"
        assert "Resource prefix (accept or edit)" not in t.text()
    elif case == "packed-alias":
        preload = pathlib.Path(sys.argv[5]).as_uri()
        t = Terminal("unused", config, command=[sys.argv[2], "setup", "--config", config],
                     PATH=sys.argv[6], NODE_OPTIONS=f"--import={preload}",
                     HTMLPUB_PACKED_ROOT=sys.argv[7], HTMLPUB_TEST_IO_LOG=config + ".calls.jsonl")
        t.answer("Subscription and directory")
        t.answer("Resource prefix (accept or edit)")
        t.answer("Publisher resources", b"\x1b")
        t.expect("Result: saved")
        t.wait_exit()
        draft = json.loads(pathlib.Path(config + ".guided.json").read_text())
        assert len(draft["prefix"]) == 40
        assert draft["prefix"].endswith("-html-publishing")
        assert not pathlib.Path(config).exists()
    else:
        raise AssertionError("unknown PTY case")
    print(f"PASS {case}: real PTY keys, restored terminal, external dispatch forbidden")
finally:
    if t:
        t.close()
