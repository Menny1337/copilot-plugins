#!/usr/bin/env node

import fs from "fs";
import path from "path";

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const profilesPath = path.resolve(scriptDir, "../references/prompt-profiles.json");

function usage() {
  console.error("Usage: node build-prompt.mjs <profile-name> [override-json]");
  process.exit(1);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) {
    return override;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isObject(value) && isObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

const [, , profileName, overrideJson] = process.argv;
if (!profileName) {
  usage();
}

const profiles = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
const baseProfile = profiles[profileName];

if (!baseProfile) {
  console.error(`Unknown profile: ${profileName}`);
  console.error(`Available profiles: ${Object.keys(profiles).join(", ")}`);
  process.exit(2);
}

let prompt = baseProfile;
if (overrideJson) {
  let overrides;
  try {
    overrides = JSON.parse(overrideJson);
  } catch (error) {
    console.error(`Invalid override JSON: ${error.message}`);
    process.exit(3);
  }
  prompt = deepMerge(baseProfile, overrides);
}

process.stdout.write(`${JSON.stringify(prompt, null, 2)}\n`);