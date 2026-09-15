import { assertNoPayload } from "../lib/control-payload.mjs";

const SHARED_DEFAULTS = {
  permissions: {
    profile: "fullAutonomy",
    allowAll: true,
    allowTools: [],
    denyTools: [],
    allowUrls: [],
    denyUrls: [],
  },
  timeoutSeconds: 1800,
  retry: {
    maxRetries: 0,
    backoffSeconds: 60,
  },
  overlapPolicy: "skip",
  notifications: {
    onFailure: true,
    onSuccess: false,
  },
  retention: {
    days: 30,
    maxRuns: 100,
  },
};

const BUILT_IN_TEMPLATES = [
  {
    key: "nightly-dependency-report",
    title: "Nightly dependency report",
    kind: "copilot",
    description: "Review dependency manifests and write a concise markdown report.",
    requiredInputs: ["workingDirectory"],
    optionalInputs: ["extraPaths", "localPluginDirectories"],
    notes: [
      "Select a repository root as the working directory.",
      "Provide REPORT_TOKEN in Copilot Loops secrets if the report needs an external destination.",
    ],
    defaults: {
      lifecycle: "draft",
      schedule: {
        kind: "calendar",
        hour: 1,
        minute: 0,
        weekdays: [],
        graceSeconds: 300,
      },
      execution: {
        type: "copilot",
        prompt: "Review dependency manifests and write a concise markdown report.",
        model: "gpt-5.6-sol",
        extraPaths: [],
        localPluginDirectories: [],
        installedPlugin: "core-agents",
        agent: "core-agents:researcher",
        skill: "research-methodology",
      },
      environment: {
        plain: {
          REPORT_FORMAT: "markdown",
        },
        secretNames: ["REPORT_TOKEN"],
      },
      ...SHARED_DEFAULTS,
    },
  },
  {
    key: "repository-maintenance",
    title: "Repository maintenance",
    kind: "script",
    description: "Run a repository maintenance script or executable on a regular cadence.",
    requiredInputs: ["workingDirectory", "path"],
    optionalInputs: ["arguments", "plainEnvironment", "secretNames"],
    notes: [
      "The default shape expects a script file with a shebang and executable bit.",
      "Swap execution.type to 'executable' if you want to pin a binary instead of a script file.",
    ],
    defaults: {
      lifecycle: "draft",
      schedule: {
        kind: "calendar",
        hour: 2,
        minute: 30,
        weekdays: [1, 2, 3, 4, 5],
        graceSeconds: 300,
      },
      execution: {
        type: "scriptFile",
        arguments: ["--prune", "--stats"],
      },
      permissions: {
        profile: "custom",
        allowAll: false,
        allowTools: [],
        denyTools: [],
        allowUrls: [],
        denyUrls: [],
      },
      environment: {
        plain: {
          DRY_RUN: "false",
        },
        secretNames: [],
      },
      timeoutSeconds: 3600,
      retry: {
        maxRetries: 0,
        backoffSeconds: 60,
      },
      overlapPolicy: "skip",
      notifications: {
        onFailure: true,
        onSuccess: false,
      },
      retention: {
        days: 30,
        maxRuns: 100,
      },
    },
  },
  {
    key: "scheduled-skill-review",
    title: "Scheduled skill review",
    kind: "copilot",
    description: "Run a recurring audit of a chosen skill or agent without adopting the dedicated scheduled-skill-review daemon.",
    requiredInputs: ["workingDirectory"],
    optionalInputs: ["extraPaths", "localPluginDirectories"],
    notes: [
      "This template performs a normal Copilot loop review and does not adopt or manage the separate scheduled-skill-review daemon.",
      "Choose the target marketplace or plugin repository as the working directory before approval.",
    ],
    defaults: {
      lifecycle: "draft",
      schedule: {
        kind: "calendar",
        hour: 9,
        minute: 0,
        weekdays: [1],
        graceSeconds: 300,
      },
      execution: {
        type: "copilot",
        prompt: "Audit the selected Copilot skill or agent for routing, frontmatter, overlap, security, and discoverability. Produce a concise actionable report.",
        model: "gpt-5.6-sol",
        extraPaths: [],
        localPluginDirectories: [],
        installedPlugin: "meta",
        agent: null,
        skill: "agent-skill-audit",
      },
      environment: {
        plain: {},
        secretNames: [],
      },
      ...SHARED_DEFAULTS,
    },
  },
  {
    key: "blank-copilot",
    title: "Blank Copilot",
    kind: "copilot",
    description: "Start from a minimal headless Copilot loop.",
    requiredInputs: ["workingDirectory"],
    optionalInputs: ["extraPaths", "localPluginDirectories", "agent", "skill", "installedPlugin"],
    notes: [
      "Replace the placeholder prompt before approval.",
    ],
    defaults: {
      lifecycle: "draft",
      schedule: {
        kind: "manual",
      },
      execution: {
        type: "copilot",
        prompt: "Describe the unattended task to automate.",
        model: "gpt-5.6-sol",
        extraPaths: [],
        localPluginDirectories: [],
        installedPlugin: null,
        agent: null,
        skill: null,
      },
      environment: {
        plain: {},
        secretNames: [],
      },
      ...SHARED_DEFAULTS,
    },
  },
  {
    key: "blank-script",
    title: "Blank Script",
    kind: "script",
    description: "Start from a minimal direct script or executable loop.",
    requiredInputs: ["workingDirectory", "path"],
    optionalInputs: ["arguments", "plainEnvironment", "secretNames"],
    notes: [
      "Choose 'scriptFile' for a shebang script or 'executable' for a pinned binary.",
    ],
    defaults: {
      lifecycle: "draft",
      schedule: {
        kind: "manual",
      },
      execution: {
        type: "scriptFile",
        arguments: [],
      },
      permissions: {
        profile: "custom",
        allowAll: false,
        allowTools: [],
        denyTools: [],
        allowUrls: [],
        denyUrls: [],
      },
      environment: {
        plain: {},
        secretNames: [],
      },
      timeoutSeconds: 1800,
      retry: {
        maxRetries: 0,
        backoffSeconds: 60,
      },
      overlapPolicy: "skip",
      notifications: {
        onFailure: true,
        onSuccess: false,
      },
      retention: {
        days: 30,
        maxRuns: 100,
      },
    },
  },
];

export async function builtInTemplates(payload = {}) {
  assertNoPayload(payload ?? {});
  return {
    schemaVersion: 1,
    templates: BUILT_IN_TEMPLATES,
  };
}
