import assert from "node:assert/strict";
import test from "node:test";
import {
  assessSchedule,
  launchdStartSpec,
  nextCalendarOccurrence,
  previousCalendarOccurrence,
} from "../lib/schedule.mjs";

test("calendar schedule renders launchd weekday entries", () => {
  assert.deepEqual(launchdStartSpec({ kind: "calendar", hour: 18, minute: 30, weekdays: [5, 1, 1] }), {
    key: "StartCalendarInterval",
    value: [
      { Hour: 18, Minute: 30, Weekday: 1 },
      { Hour: 18, Minute: 30, Weekday: 5 },
    ],
  });
});

test("once schedule renders local launchd calendar components", () => {
  const previousTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    assert.deepEqual(launchdStartSpec({ kind: "once", scheduledAt: "2026-11-03T15:45:00Z" }), {
      key: "StartCalendarInterval",
      value: { Month: 11, Day: 3, Hour: 10, Minute: 45 },
    });
  } finally {
    process.env.TZ = previousTz;
  }
});

test("calendar helpers honor local DST transitions", () => {
  const previousTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const schedule = { kind: "calendar", hour: 2, minute: 30, weekdays: [0], graceSeconds: 300 };
    const from = new Date("2026-03-08T06:20:00Z");
    const next = nextCalendarOccurrence(schedule, from);
    const previous = previousCalendarOccurrence(schedule, new Date("2026-03-08T07:35:00Z"));
    assert.equal(next?.toISOString(), "2026-03-08T07:30:00.000Z");
    assert.equal(previous?.toISOString(), "2026-03-08T07:30:00.000Z");
  } finally {
    process.env.TZ = previousTz;
  }
});

test("calendar freshness uses grace windows and de-duplicates consumed slots", () => {
  const schedule = { kind: "calendar", hour: 10, minute: 0, weekdays: [], graceSeconds: 300 };
  const due = assessSchedule(schedule, {}, { now: "2026-07-24T10:03:00Z" });
  assert.equal(due.due, true);
  assert.equal(due.reason, "due");
  assert.equal(due.scheduledAt, "2026-07-24T10:00:00.000Z");

  const consumed = assessSchedule(schedule, due.state, { now: "2026-07-24T10:04:00Z" });
  assert.equal(consumed.due, false);
  assert.equal(consumed.reason, "already-consumed");

  const stale = assessSchedule(schedule, {}, { now: "2026-07-24T10:06:00Z" });
  assert.equal(stale.due, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.reason, "stale");
  assert.equal(stale.consumed, true);
  assert.equal(stale.state.lastScheduledAt, "2026-07-24T10:00:00.000Z");

  const deduped = assessSchedule(schedule, stale.state, { now: "2026-07-24T10:07:00Z" });
  assert.equal(deduped.reason, "already-consumed");
});

test("once schedules are consumed after first eligible window", () => {
  const schedule = { kind: "once", scheduledAt: "2026-07-24T10:00:00Z", graceSeconds: 300 };
  const due = assessSchedule(schedule, {}, { now: "2026-07-24T10:04:00Z" });
  assert.equal(due.due, true);
  assert.equal(due.consumed, true);
  assert.equal(due.state.consumedAt, "2026-07-24T10:00:00.000Z");

  const consumed = assessSchedule(schedule, due.state, { now: "2026-07-24T10:04:30Z" });
  assert.equal(consumed.reason, "consumed");
  assert.equal(consumed.due, false);

  const expired = assessSchedule(schedule, {}, { now: "2026-07-24T10:06:00Z" });
  assert.equal(expired.reason, "expired");
  assert.equal(expired.consumed, true);
});

test("interval schedules initialize, fire within grace, and reset after stale wake", () => {
  const schedule = { kind: "interval", seconds: 3600, graceSeconds: 300 };

  const initialized = assessSchedule(schedule, {}, { now: "2026-07-24T10:00:00Z" });
  assert.equal(initialized.reason, "initialized");
  assert.equal(initialized.nextExpectedAt, "2026-07-24T11:00:00.000Z");

  const due = assessSchedule(schedule, initialized.state, { now: "2026-07-24T11:03:00Z" });
  assert.equal(due.due, true);
  assert.equal(due.scheduledAt, "2026-07-24T11:00:00.000Z");
  assert.equal(due.nextExpectedAt, "2026-07-24T12:00:00.000Z");

  const reset = assessSchedule(schedule, initialized.state, { now: "2026-07-24T11:06:00Z" });
  assert.equal(reset.due, false);
  assert.equal(reset.reset, true);
  assert.equal(reset.reason, "wake-skip-reset");
  assert.equal(reset.nextExpectedAt, "2026-07-24T12:06:00.000Z");
});
