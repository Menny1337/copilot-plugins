import fsp from "node:fs/promises";
import path from "node:path";
import { appLabel, setLabelEnabled } from "../lib/control-runtime.mjs";
import {
  assertNoPayload,
  exactPayload,
  ensureObject,
  optionalAbsolutePath,
  optionalBoolean,
  optionalInteger,
  optionalString,
} from "../lib/control-payload.mjs";
import { UserError } from "../lib/errors.mjs";
import { stateRoot } from "../lib/paths.mjs";
import { withGlobalMutation } from "../lib/store.mjs";

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  notificationsEnabled: true,
  launchAtLogin: true,
  defaultModel: null,
  defaultTimeoutSeconds: 1800,
  stateRoot: null,
};

function settingsPath(env = process.env) {
  return path.join(stateRoot(env), "settings.json");
}

function validateSettingsObject(input) {
  const settings = ensureObject(input, "payload.settings");
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  for (const key of Object.keys(settings)) {
    if (!allowed.has(key)) {
      throw new UserError(`unknown setting field: ${key}`, { field: key });
    }
  }

  const validated = { ...DEFAULT_SETTINGS };
  if (settings.schemaVersion !== undefined && settings.schemaVersion !== 1) {
    throw new UserError("schemaVersion must be 1", { field: "schemaVersion", value: settings.schemaVersion });
  }
  if (settings.notificationsEnabled !== undefined) {
    validated.notificationsEnabled = optionalBoolean(settings.notificationsEnabled, "payload.settings.notificationsEnabled");
  }
  if (settings.launchAtLogin !== undefined) {
    validated.launchAtLogin = optionalBoolean(settings.launchAtLogin, "payload.settings.launchAtLogin");
  }
  if (settings.defaultModel !== undefined) {
    if (settings.defaultModel !== null) {
      validated.defaultModel = optionalString(settings.defaultModel, "payload.settings.defaultModel");
    } else {
      validated.defaultModel = null;
    }
  }
  if (settings.defaultTimeoutSeconds !== undefined) {
    validated.defaultTimeoutSeconds = optionalInteger(settings.defaultTimeoutSeconds, "payload.settings.defaultTimeoutSeconds", {
      minimum: 0,
      maximum: 604800,
    });
  }
  if (settings.stateRoot !== undefined) {
    validated.stateRoot = settings.stateRoot === null
      ? null
      : optionalAbsolutePath(settings.stateRoot, "payload.settings.stateRoot");
  }
  return validated;
}

async function readSettingsFile(env = process.env) {
  try {
    const raw = await fsp.readFile(settingsPath(env), "utf8");
    return validateSettingsObject(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") return { ...DEFAULT_SETTINGS };
    if (error instanceof UserError) {
      throw new UserError(`settings.json is invalid: ${error.message}`, error.context);
    }
    throw error;
  }
}

async function writeSettingsFile(settings, env = process.env) {
  const filePath = settingsPath(env);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(tempPath, JSON.stringify(settings, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await fsp.rename(tempPath, filePath);
}

function launchToggleOptions(options) {
  return {
    env: options.env,
    uid: options.uid,
    run: options.run,
    launchctlPath: options.launchctlPath,
  };
}

export async function getSettings(payload = {}, options = {}) {
  assertNoPayload(payload ?? {});
  return {
    schemaVersion: 1,
    settings: await readSettingsFile(options.env ?? process.env),
  };
}

export async function setSettings(payload, options = {}) {
  const body = exactPayload(payload ?? {}, { required: ["settings"], optional: [] });
  const validated = validateSettingsObject(body.settings);
  const env = options.env ?? process.env;
  const resolvedAppLabel = appLabel(env);
  return await withGlobalMutation(env, async () => {
  const current = await readSettingsFile(env);
  let launchdChanged = false;

    if (validated.launchAtLogin !== current.launchAtLogin) {
      try {
        await setLabelEnabled(resolvedAppLabel, validated.launchAtLogin, launchToggleOptions(options));
        launchdChanged = true;
      } catch (error) {
        throw new UserError(`Failed to reconcile launchAtLogin with launchctl: ${error.message}`, {
          label: resolvedAppLabel,
          desired: validated.launchAtLogin,
          cause: error.message,
        });
      }
    }

    try {
      await writeSettingsFile(validated, env);
    } catch (error) {
      if (launchdChanged) {
        try {
          await setLabelEnabled(resolvedAppLabel, current.launchAtLogin, launchToggleOptions(options));
        } catch (rollbackError) {
          throw new UserError("Failed to persist settings after changing launchAtLogin, and rollback also failed", {
            label: resolvedAppLabel,
            desired: validated.launchAtLogin,
            previous: current.launchAtLogin,
            cause: error.message,
            rollback: rollbackError.message,
          });
        }
      }
      throw new UserError(`Failed to persist settings: ${error.message}`, { cause: error.message });
    }

  return {
    schemaVersion: 1,
    settings: validated,
  };
  }, options);
}
