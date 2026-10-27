import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const IDENTITY_SCHEMA_VERSION = 1;
export const PUBLIC_IDENTITY_NAMESPACE = "com.copilotplugins.copilot-loops";
export const DEFAULT_IDENTITY_PROFILE = "default";
export const CUSTOM_IDENTITY_PROFILE = "custom";

const NAMESPACE_SEGMENT = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/;

export class IdentityConfigError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = "IdentityConfigError";
    this.context = context;
  }
}

function homeDirectory(env = process.env) {
  const home = typeof env.HOME === "string" && env.HOME.length > 0 ? env.HOME : os.homedir();
  if (!path.isAbsolute(home)) {
    throw new TypeError("HOME must be an absolute path");
  }
  return path.normalize(home);
}

export function stateRoot(env = process.env) {
  if (env.COPILOT_LOOPS_HOME !== undefined) {
    if (typeof env.COPILOT_LOOPS_HOME !== "string" || !path.isAbsolute(env.COPILOT_LOOPS_HOME)) {
      throw new TypeError("COPILOT_LOOPS_HOME must be an absolute path");
    }
    return path.normalize(env.COPILOT_LOOPS_HOME);
  }
  return path.join(homeDirectory(env), ".copilot", "scheduled-tasks", "copilot-loops");
}

export function identityPath(env = process.env) {
  return path.join(stateRoot(env), "identity.json");
}

export function validateIdentityNamespace(value) {
  if (typeof value !== "string") {
    throw new IdentityConfigError("identity namespace must be a string", { field: "namespace" });
  }
  const segments = value.split(".");
  if (segments.length < 3 || segments.some((segment) => !NAMESPACE_SEGMENT.test(segment))) {
    throw new IdentityConfigError(
      "identity namespace must contain at least three lowercase reverse-DNS segments",
      { field: "namespace", value },
    );
  }
  return value;
}

export function validateIdentityConfig(input, options = {}) {
  const sourcePath = options.sourcePath ?? "identity.json";
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new IdentityConfigError(`${sourcePath} must contain a JSON object`);
  }
  if (input.schemaVersion !== IDENTITY_SCHEMA_VERSION) {
    throw new IdentityConfigError(
      `${sourcePath} schemaVersion must be ${IDENTITY_SCHEMA_VERSION}`,
      { field: "schemaVersion", value: input.schemaVersion },
    );
  }
  if (input.profile !== DEFAULT_IDENTITY_PROFILE && input.profile !== CUSTOM_IDENTITY_PROFILE) {
    throw new IdentityConfigError(
      `${sourcePath} profile must be "${DEFAULT_IDENTITY_PROFILE}" or "${CUSTOM_IDENTITY_PROFILE}"`,
      { field: "profile", value: input.profile },
    );
  }

  let namespace;
  if (input.profile === DEFAULT_IDENTITY_PROFILE) {
    if (input.namespace !== undefined && input.namespace !== PUBLIC_IDENTITY_NAMESPACE) {
      throw new IdentityConfigError(
        `${sourcePath} default profile namespace must be omitted or "${PUBLIC_IDENTITY_NAMESPACE}"`,
        { field: "namespace", value: input.namespace },
      );
    }
    namespace = PUBLIC_IDENTITY_NAMESPACE;
  } else {
    if (input.namespace === undefined) {
      throw new IdentityConfigError(`${sourcePath} custom profile requires namespace`, {
        field: "namespace",
      });
    }
    namespace = validateIdentityNamespace(input.namespace);
  }

  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    profile: input.profile,
    namespace,
    bundleIdentifier: namespace,
    appLabel: `${namespace}.app`,
    taskLabelPrefix: `${namespace}.task.`,
    keychainService: `${namespace}.secrets`,
    dispatchQueuePrefix: namespace,
    sourcePath,
    configured: true,
    raw: input,
  };
}

export function defaultIdentity(sourcePath = null) {
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    profile: DEFAULT_IDENTITY_PROFILE,
    namespace: PUBLIC_IDENTITY_NAMESPACE,
    bundleIdentifier: PUBLIC_IDENTITY_NAMESPACE,
    appLabel: `${PUBLIC_IDENTITY_NAMESPACE}.app`,
    taskLabelPrefix: `${PUBLIC_IDENTITY_NAMESPACE}.task.`,
    keychainService: `${PUBLIC_IDENTITY_NAMESPACE}.secrets`,
    dispatchQueuePrefix: PUBLIC_IDENTITY_NAMESPACE,
    sourcePath,
    configured: false,
    raw: null,
  };
}

function parseIdentity(raw, sourcePath) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new IdentityConfigError(`${sourcePath} is not valid JSON: ${error.message}`, {
      sourcePath,
    });
  }
  return validateIdentityConfig(value, { sourcePath });
}

export function loadIdentity(env = process.env, options = {}) {
  const sourcePath = options.identityPath ?? identityPath(env);
  const readFileSync = options.readFileSync ?? fs.readFileSync;
  const lstatSync = options.lstatSync ?? fs.lstatSync;
  try {
    return parseIdentity(readFileSync(sourcePath, "utf8"), sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      try {
        lstatSync(sourcePath);
      } catch (entryError) {
        if (entryError?.code === "ENOENT") return defaultIdentity(sourcePath);
        throw entryError;
      }
    }
    throw error;
  }
}

function hasLegacyInstallMarkers(env, options = {}) {
  const root = stateRoot(env);
  const home = homeDirectory(env);
  const existsSync = options.existsSync ?? fs.existsSync;
  const readdirSync = options.readdirSync ?? fs.readdirSync;
  const installedApp = path.join(home, "Applications", "CopilotLoops.app");
  if (existsSync(installedApp)) return true;
  if (!existsSync(root)) return false;
  try {
    return readdirSync(root).some((entry) => entry !== "identity.json");
  } catch (error) {
    throw new IdentityConfigError(`Could not inspect existing Copilot Loops state at ${root}: ${error.message}`);
  }
}

function legacyProfileRequiredMessage(env) {
  const profilePath = identityPath(env);
  return [
    "Existing Copilot Loops installation or state has no identity profile.",
    `Create ${profilePath} with schemaVersion 1, profile "custom", and the namespace used by the existing installation before continuing.`,
    "The installer will not guess or rename durable LaunchAgent or Keychain identities.",
  ].join(" ");
}

export function prepareInstallIdentity(env = process.env, options = {}) {
  const loaded = loadIdentity(env, options);
  if (loaded.configured) return loaded;
  if (hasLegacyInstallMarkers(env, options)) {
    throw new IdentityConfigError(legacyProfileRequiredMessage(env), {
      code: "identity-profile-required",
      sourcePath: identityPath(env),
    });
  }

  const profilePath = identityPath(env);
  const mkdirSync = options.mkdirSync ?? fs.mkdirSync;
  const writeFileSync = options.writeFileSync ?? fs.writeFileSync;
  const linkSync = options.linkSync ?? fs.linkSync;
  const rmSync = options.rmSync ?? fs.rmSync;
  const tempPath = `${profilePath}.${process.pid}.tmp`;
  mkdirSync(path.dirname(profilePath), { recursive: true });
  const config = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    profile: DEFAULT_IDENTITY_PROFILE,
  };
  let temporaryCreated = false;
  try {
    writeFileSync(tempPath, JSON.stringify(config, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    temporaryCreated = true;
    linkSync(tempPath, profilePath);
    rmSync(tempPath);
  } catch (error) {
    if (temporaryCreated) {
      try {
        rmSync(tempPath, { force: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Identity profile creation and temporary-file cleanup failed",
        );
      }
    }
    throw error;
  }
  return validateIdentityConfig(config, { sourcePath: profilePath });
}

export function prepareUninstallIdentity(env = process.env, options = {}) {
  const loaded = loadIdentity(env, options);
  if (loaded.configured) return loaded;
  if (hasLegacyInstallMarkers(env, options)) {
    throw new IdentityConfigError(legacyProfileRequiredMessage(env), {
      code: "identity-profile-required",
      sourcePath: identityPath(env),
    });
  }
  return loaded;
}

export function publicIdentityConfig() {
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    profile: DEFAULT_IDENTITY_PROFILE,
  };
}
