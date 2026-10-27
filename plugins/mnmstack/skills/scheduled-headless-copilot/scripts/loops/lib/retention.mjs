// retention.mjs — enforce a loop's `retention.days` / `retention.maxRuns` policy.
//
// A run directory is pruned when it is EITHER older than `retention.days` OR ranked beyond
// the `retention.maxRuns` most-recent runs — the two limits are independent caps applied
// together (age-based expiry and a hard count cap), matching "30 days / max runs" read as
// two separate ceilings rather than one gate depending on the other. A run that is still
// active (non-terminal status) is never pruned, however old or however low its rank, since
// deleting a live run's directory would pull the rug out from under
// `--log-dir`/events.jsonl/state.json mid-flight.

import fs from "node:fs";
import { listRuns, isTerminalStatus } from "./run-state.mjs";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function runTimestamp(record) {
  return record.endedAt ?? record.startedAt ?? record.scheduledFor ?? null;
}

/**
 * Prune `loopId`'s run directories per `retention` = `{ days, maxRuns }`.
 * Returns the list of removed run ids (newest-first ordering preserved from listRuns).
 */
export function enforceRetention({ loopId, retention, env = process.env, now = new Date() }) {
  const { days, maxRuns } = retention;
  if (!Number.isInteger(days) || days < 1) throw new TypeError("retention.days must be a positive integer");
  if (!Number.isInteger(maxRuns) || maxRuns < 1) throw new TypeError("retention.maxRuns must be a positive integer");

  const runs = listRuns(loopId, env); // newest-first
  const cutoff = now.getTime() - days * MS_PER_DAY;
  const removed = [];

  runs.forEach((run, rank) => {
    if (!isTerminalStatus(run.record.status)) return; // never prune an in-flight run

    const beyondCountCap = rank >= maxRuns;
    const ts = runTimestamp(run.record);
    const isStale = ts === null ? true : new Date(ts).getTime() < cutoff;
    if (!beyondCountCap && !isStale) return; // within both caps — keep it

    fs.rmSync(run.dir, { recursive: true, force: true });
    removed.push(run.id);
  });

  return removed;
}
