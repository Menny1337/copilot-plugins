#!/usr/bin/env node
import fs from "node:fs";
import { LOOP_SCHEMA_VERSION } from "./loops/lib/contracts.mjs";
import { appLabel, taskLabelPrefix } from "./loops/lib/paths.mjs";
import { UserError } from "./loops/lib/errors.mjs";

import { createLoop, updateLoop, showLoop, listLoopsCmd, purgeLoop } from "./loops/commands/crud.mjs";
import { approveLoopCmd, enableLoop, pauseLoop, resumeLoop, archiveLoop, runNow, stopLoop, retryLoop, reconcileLoops, preflightLoop } from "./loops/commands/lifecycle.mjs";
import { getSettings, setSettings } from "./loops/commands/settings.mjs";
import { getInventory } from "./loops/commands/inventory.mjs";
import { aggregateLoops } from "./loops/commands/aggregate.mjs";
import { loopHistory } from "./loops/commands/history.mjs";
import { builtInTemplates } from "./loops/commands/templates.mjs";
import { runtimeDiagnostics } from "./loops/commands/diagnostics.mjs";

function usage() {
  process.stdout.write(`Copilot Loops control plane

Usage: node loops-ctl.mjs <command>

Commands:
  list | show | aggregate | history
  create | update | approve | enable | pause | resume | archive | purge
  run-now | stop | retry | reconcile | preflight
  inventory | templates | diagnostics
  settings-get | settings-set

Contract:
  JSON payloads are read from stdin.
  Machine-readable results are written to stdout.
  Diagnostics and actionable failures are written to stderr.
`);
}

async function main() {
  const command = process.argv[2] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }
  if (command === "contract") {
    process.stdout.write(
      JSON.stringify(
        {
          schemaVersion: LOOP_SCHEMA_VERSION,
          appLabel: appLabel(process.env),
          taskLabelPrefix: taskLabelPrefix(process.env),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  try {
    let input = "";
    if (!process.stdin.isTTY) {
      try {
        input = fs.readFileSync(0, "utf8");
      } catch (error) {
        throw new UserError(`Failed to read stdin: ${error.message}`);
      }
    }
    const payload = input.trim() ? JSON.parse(input) : {};

    let result;
    const commandOptions = { env: process.env };
    switch (command) {
      case "create": result = await createLoop(payload, commandOptions); break;
      case "update": result = await updateLoop(payload, commandOptions); break;
      case "show": result = await showLoop(payload, commandOptions); break;
      case "list": result = await listLoopsCmd(payload, commandOptions); break;
      case "aggregate": result = await aggregateLoops(payload, commandOptions); break;
      case "history": result = await loopHistory(payload, commandOptions); break;
      case "purge": result = await purgeLoop(payload, commandOptions); break;
      case "approve": result = await approveLoopCmd(payload, commandOptions); break;
      case "enable": result = await enableLoop(payload, commandOptions); break;
      case "pause": result = await pauseLoop(payload, commandOptions); break;
      case "resume": result = await resumeLoop(payload, commandOptions); break;
      case "archive": result = await archiveLoop(payload, commandOptions); break;
      case "run-now": result = await runNow(payload, commandOptions); break;
      case "stop": result = await stopLoop(payload, commandOptions); break;
      case "retry": result = await retryLoop(payload, commandOptions); break;
      case "reconcile": result = await reconcileLoops(payload, commandOptions); break;
      case "preflight": result = await preflightLoop(payload, commandOptions); break;
      case "settings-get": result = await getSettings(payload, commandOptions); break;
      case "settings-set": result = await setSettings(payload, commandOptions); break;
      case "inventory": result = await getInventory(payload, undefined, commandOptions); break;
      case "templates": result = await builtInTemplates(payload, commandOptions); break;
      case "diagnostics": result = await runtimeDiagnostics(payload, commandOptions); break;
      default:
        throw new UserError(`unknown command: ${command}`);
    }

    process.stdout.write(JSON.stringify({ ok: true, data: result }, null, 2) + "\n");
  } catch (error) {
    if (error.message) {
      process.stderr.write(`Error: ${error.message}\n`);
    }
    const errorBody = {
      ok: false,
      error: {
        name: error.name,
        message: error.message,
        context: error instanceof UserError ? error.context : {},
      },
    };
    if (error.code) errorBody.error.code = error.code;
    process.stdout.write(JSON.stringify(errorBody, null, 2) + "\n");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
