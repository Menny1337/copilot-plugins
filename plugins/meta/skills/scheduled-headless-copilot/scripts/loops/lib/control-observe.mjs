import fs from "node:fs";
import path from "node:path";
import { capabilityFingerprint, validateRunRecord } from "./contracts.mjs";
import { loopDirectory } from "./paths.mjs";
import { runPaths } from "./run-state.mjs";
import { assessSchedule } from "./schedule.mjs";
import { listLoops, readLoop } from "./store.mjs";

function defaultScheduleState() {
  return {
    consumedAt: null,
    lastScheduledAt: null,
    nextExpectedAt: null,
  };
}

function defaultLoopState(loopId = null) {
  return {
    schemaVersion: 1,
    loopId,
    schedule: defaultScheduleState(),
    active: null,
    lastRun: null,
    updatedAt: null,
  };
}

function issue({ id = null, code, message, context = {} }) {
  return { id, code, message, context };
}

function safeReadJson(filePath) {
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, "utf8")), error: null };
  } catch (error) {
    if (error?.code === "ENOENT") return { value: null, error: null };
    return { value: null, error };
  }
}

function safeLoopState(loopId, env = process.env) {
  const statePath = path.join(loopDirectory(loopId, env), "state.json");
  const loaded = safeReadJson(statePath);
  if (loaded.error) {
    return {
      state: defaultLoopState(loopId),
      issues: [issue({
        id: loopId,
        code: "state-read-failed",
        message: `Failed to read ${statePath}: ${loaded.error.message}`,
      })],
    };
  }
  const state = loaded.value && typeof loaded.value === "object" && !Array.isArray(loaded.value)
    ? loaded.value
    : defaultLoopState(loopId);
  return {
    state: {
      ...defaultLoopState(loopId),
      ...state,
      schedule: { ...defaultScheduleState(), ...(state.schedule ?? {}) },
      active: state.active ?? null,
      lastRun: state.lastRun ?? null,
    },
    issues: [],
  };
}

function safeRuns(loopId, env = process.env) {
  const runsRoot = path.join(loopDirectory(loopId, env), "runs");
  let entries = [];
  try {
    entries = fs.readdirSync(runsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { runs: [], issues: [] };
    }
    return {
      runs: [],
      issues: [issue({
        id: loopId,
        code: "runs-read-failed",
        message: `Failed to read ${runsRoot}: ${error.message}`,
      })],
    };
  }

  const runs = [];
  const issues = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const paths = runPaths(loopId, entry.name, env);
    const loaded = safeReadJson(paths.runJson);
    if (!loaded.value) {
      if (loaded.error) {
        issues.push(issue({
          id: loopId,
          code: "run-read-failed",
          message: `Failed to read ${paths.runJson}: ${loaded.error.message}`,
          context: { runId: entry.name },
        }));
      }
      continue;
    }
    try {
      const record = validateRunRecord(loaded.value);
      runs.push({ id: entry.name, dir: paths.dir, paths, record });
    } catch (error) {
      issues.push(issue({
        id: loopId,
        code: "run-invalid",
        message: `Invalid run record ${paths.runJson}: ${error.message}`,
        context: { runId: entry.name },
      }));
    }
  }
  runs.sort((left, right) => (left.id < right.id ? 1 : left.id > right.id ? -1 : 0));
  return { runs, issues };
}

function nextScheduledAt(loop, scheduleState, now) {
  try {
    return assessSchedule(loop.schedule, scheduleState, { now }).nextExpectedAt ?? null;
  } catch {
    return null;
  }
}

function latestCliLogPath(cliLogsDir) {
  try {
    const files = fs
      .readdirSync(cliLogsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(cliLogsDir, entry.name))
      .sort();
    return files.at(-1) ?? null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

function fileIfExists(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

function directoryIfExists(dirPath) {
  try {
    const stats = fs.statSync(dirPath);
    return stats.isDirectory() ? dirPath : null;
  } catch {
    return null;
  }
}

function artifactPaths(paths) {
  if (!paths) return null;
  return {
    stdoutPath: fileIfExists(paths.stdoutLog),
    stderrPath: fileIfExists(paths.stderrLog),
    copilotJsonlPath: fileIfExists(paths.copilotLog),
    eventsPath: fileIfExists(paths.eventsLog),
    cliLogsDirectory: directoryIfExists(paths.cliLogsDir),
    latestCliLogPath: latestCliLogPath(paths.cliLogsDir),
  };
}

function loopStateSummary(inspection) {
  return {
    isRunning: inspection.state.isRunning,
    currentRunId: inspection.state.currentRunId,
    stage: inspection.state.stage,
    nextScheduledAt: inspection.state.nextScheduledAt,
    currentFingerprint: inspection.state.currentFingerprint,
    reconciliationError: inspection.state.reconciliationError,
    issueCount: inspection.issues.length,
    needsAttention: inspection.issues.length > 0 || inspection.state.reconciliationError !== null,
  };
}

function listLoopEntry(inspection) {
  return {
    definition: inspection.loop,
    stateSummary: loopStateSummary(inspection),
    lastRun: inspection.state.lastRun,
  };
}

function aggregateLoopEntry(inspection) {
  const summary = loopStateSummary(inspection);
  return {
    definition: inspection.loop,
    state: structuredClone(inspection.observedState),
    lastRun: inspection.state.lastRun,
    nextScheduledAt: summary.nextScheduledAt,
    currentFingerprint: summary.currentFingerprint,
    reconciliationError: summary.reconciliationError,
    isRunning: summary.isRunning,
    currentRunId: summary.currentRunId,
    stage: summary.stage,
    issues: [...inspection.issues],
  };
}

function recentRunEntry(entry) {
  return {
    loopId: entry.record.loopId,
    run: entry.record,
    artifacts: artifactPaths(entry.paths),
  };
}

function currentRunEntry(inspection, env = process.env) {
  const runId = inspection.state.currentRunId;
  if (!runId) return null;
  return {
    runId,
    artifacts: artifactPaths(runPaths(inspection.loop.id, runId, env)),
  };
}

export function inspectLoop(loop, options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const stateInfo = safeLoopState(loop.id, env);
  const runsInfo = safeRuns(loop.id, env);
  const currentFingerprint = capabilityFingerprint(loop);
  const active = stateInfo.state.active ?? null;
  const latestRun = runsInfo.runs[0] ?? null;
  const loopIssues = [...stateInfo.issues, ...runsInfo.issues];

  if (loop.lifecycle === "draft" || loop.lifecycle === "needsReview") {
    loopIssues.push(issue({
      id: loop.id,
      code: "approval-required",
      message: "Loop requires approval before it can be enabled",
    }));
  }
  if (loop.approval?.fingerprint && loop.approval.fingerprint !== currentFingerprint) {
    loopIssues.push(issue({
      id: loop.id,
      code: "approval-drift",
      message: "Approved capability fingerprint no longer matches the current definition",
    }));
  }
  if (loop.schedule.kind === "once" && stateInfo.state.schedule?.consumedAt && ["ready", "enabled", "paused"].includes(loop.lifecycle)) {
    loopIssues.push(issue({
      id: loop.id,
      code: "one-time-consumed",
      message: "One-time loop has already been consumed and should be reconciled out of launchd",
      context: { consumedAt: stateInfo.state.schedule.consumedAt },
    }));
  }
  if (active?.orphan) {
    loopIssues.push(issue({
      id: loop.id,
      code: "orphaned-process-group",
      message: "A previous run's process group could not be confirmed dead — new fires are blocked until it is",
      context: {
        pid: active.pid ?? null,
        pgid: active.pgid ?? null,
        reason: active.orphan.reason ?? null,
        since: active.orphan.since ?? null,
        runId: active.currentRunId ?? active.runId ?? null,
      },
    }));
  }
  if (["failed", "timedOut", "launchFailed", "approvalBlocked"].includes(latestRun?.record?.status)) {
    loopIssues.push(issue({
      id: loop.id,
      code: "last-run-failed",
      message: `Last run ended ${latestRun.record.status}`,
      context: { runId: latestRun.id, status: latestRun.record.status },
    }));
  }

  return {
    loop,
    state: {
      definition: loop,
      lastRun: latestRun?.record ?? null,
      isRunning: Boolean(active && (active.currentRunId || active.runId || active.pid)),
      nextScheduledAt: nextScheduledAt(loop, stateInfo.state.schedule, now),
      currentFingerprint,
      stage: active?.stage ?? null,
      currentRunId: active?.currentRunId ?? active?.runId ?? null,
      reconciliationError: options.reconciliationErrors?.get(loop.id) ?? null,
    },
    observedState: stateInfo.state,
    runs: runsInfo.runs,
    issues: loopIssues,
    scheduleState: stateInfo.state.schedule,
    active,
  };
}

function responseErrors(listErrors = []) {
  return listErrors.map((entry) => issue({
    id: entry.id ?? null,
    code: entry.error ? String(entry.error).toLowerCase() : "loop-read-failed",
    message: entry.message,
  }));
}

export async function inspectAllLoops(options = {}) {
  const listed = await listLoops(options.env ?? process.env);
  const inspections = listed.loops
    .map((loop) => inspectLoop(loop, options))
    .sort((left, right) => left.loop.id.localeCompare(right.loop.id));
  return {
    inspections,
    errors: responseErrors(listed.errors),
  };
}

export async function listLoopStatesResponse(options = {}) {
  const result = await inspectAllLoops(options);
  return {
    schemaVersion: 1,
    loops: result.inspections.map((inspection) => listLoopEntry(inspection)),
    errors: result.errors,
  };
}

export async function loopDetailResponse(loopId, options = {}) {
  const env = options.env ?? process.env;
  const count = options.count ?? 20;
  const loop = await readLoop(loopId, env);
  const inspection = inspectLoop(loop, options);
  const recentRuns = inspection.runs.slice(0, count).map((run) => recentRunEntry(run));
  return {
    schemaVersion: 1,
    definition: inspection.loop,
    state: structuredClone(inspection.observedState),
    summary: loopStateSummary(inspection),
    currentRun: currentRunEntry(inspection, env),
    recentRuns: {
      requestedCount: count,
      count: recentRuns.length,
      runs: recentRuns,
    },
    errors: inspection.issues,
    loopDirectory: loopDirectory(loopId, env),
  };
}

function sortHistoryItems(left, right) {
  const leftKey = left.run.startedAt ?? left.run.scheduledFor ?? left.run.endedAt ?? left.run.id;
  const rightKey = right.run.startedAt ?? right.run.scheduledFor ?? right.run.endedAt ?? right.run.id;
  if (leftKey === rightKey) return left.run.id < right.run.id ? 1 : left.run.id > right.run.id ? -1 : 0;
  return leftKey < rightKey ? 1 : -1;
}

function historyItem(entry) {
  return recentRunEntry(entry);
}

export async function historyResponse(options = {}) {
  const env = options.env ?? process.env;
  const requestedCount = options.count ?? 20;
  const count = Math.max(1, requestedCount);
  const errors = [];
  let runs = [];

  if (options.loopId) {
    const loop = await readLoop(options.loopId, env);
    const inspection = inspectLoop(loop, options);
    runs = inspection.runs;
    errors.push(...inspection.issues);
  } else {
    const all = await inspectAllLoops(options);
    errors.push(...all.errors);
    runs = all.inspections.flatMap((inspection) => inspection.runs);
  }

  const items = runs
    .map((entry) => ({ run: entry.record, paths: entry.paths }))
    .map((entry) => historyItem({ record: entry.run, paths: entry.paths }))
    .sort(sortHistoryItems)
    .slice(0, count);

  return {
    schemaVersion: 1,
    loopId: options.loopId ?? null,
    requestedCount,
    count: items.length,
    runs: items,
    errors,
    stateRoot: env.COPILOT_LOOPS_HOME ?? null,
  };
}

export async function aggregateResponse(options = {}) {
  const recentCount = options.recentCount ?? 10;
  const all = await inspectAllLoops(options);
  const loops = all.inspections.map((inspection) => aggregateLoopEntry(inspection));
  const lifecycleCounts = Object.fromEntries(loops.map((entry) => [entry.definition.lifecycle, 0]));
  const lastRunStatusCounts = {};
  const runningLoopIds = [];
  const needsAttentionLoopIds = new Set();
  let nextScheduledAt = null;

  for (const entry of loops) {
    lifecycleCounts[entry.definition.lifecycle] = (lifecycleCounts[entry.definition.lifecycle] ?? 0) + 1;
    if (entry.lastRun?.status) {
      lastRunStatusCounts[entry.lastRun.status] = (lastRunStatusCounts[entry.lastRun.status] ?? 0) + 1;
    }
    if (entry.isRunning) runningLoopIds.push(entry.definition.id);
    if (entry.nextScheduledAt && (nextScheduledAt === null || entry.nextScheduledAt < nextScheduledAt)) {
      nextScheduledAt = entry.nextScheduledAt;
    }
  }
  for (const inspection of all.inspections) {
    for (const loopIssue of inspection.issues) {
      needsAttentionLoopIds.add(inspection.loop.id);
    }
  }
  for (const error of all.errors) {
    if (error.id) needsAttentionLoopIds.add(error.id);
  }

  const history = await historyResponse({ ...options, count: recentCount });
  return {
    schemaVersion: 1,
    counts: {
      totalLoops: loops.length,
      byLifecycle: lifecycleCounts,
      byLastRunStatus: lastRunStatusCounts,
      runningLoops: runningLoopIds.length,
      needsAttentionLoops: needsAttentionLoopIds.size,
    },
    runningLoopIds,
    needsAttentionLoopIds: [...needsAttentionLoopIds].sort(),
    nextScheduledAt,
    loops,
    recentActivity: {
      requestedCount: history.requestedCount,
      count: history.count,
      entries: history.runs,
    },
    errors: all.errors,
  };
}
