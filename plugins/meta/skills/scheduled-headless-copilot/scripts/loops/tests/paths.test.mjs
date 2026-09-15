import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loopDirectory, stateRoot } from "../lib/paths.mjs";

test("stateRoot requires an absolute COPILOT_LOOPS_HOME", () => {
  const absolute = path.join(process.cwd(), "plugins", "..", "plugins", "meta");
  assert.equal(stateRoot({ COPILOT_LOOPS_HOME: absolute }), path.normalize(absolute));
  assert.equal(
    loopDirectory("valid-loop", { COPILOT_LOOPS_HOME: absolute }),
    path.join(path.normalize(absolute), "tasks", "valid-loop"),
  );

  assert.throws(
    () => stateRoot({ COPILOT_LOOPS_HOME: "relative/loops-home" }),
    /COPILOT_LOOPS_HOME must be an absolute path/,
  );
  assert.throws(
    () => stateRoot({ COPILOT_LOOPS_HOME: 123 }),
    /COPILOT_LOOPS_HOME must be an absolute path/,
  );
});
