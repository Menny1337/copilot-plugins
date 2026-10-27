#!/usr/bin/env node
import {
  loadIdentity,
  prepareInstallIdentity,
  prepareUninstallIdentity,
} from "./identity.mjs";

function printable(identity) {
  const { raw: _raw, ...value } = identity;
  return value;
}

try {
  const command = process.argv[2] ?? "resolve";
  const identity = command === "prepare-install"
    ? prepareInstallIdentity(process.env)
    : command === "prepare-uninstall"
      ? prepareUninstallIdentity(process.env)
      : command === "resolve"
        ? loadIdentity(process.env)
        : null;
  if (!identity) {
    throw new Error(`unknown identity command: ${command}`);
  }
  process.stdout.write(JSON.stringify(printable(identity)) + "\n");
} catch (error) {
  process.stderr.write(`Identity error: ${error.message}\n`);
  process.exitCode = 1;
}
