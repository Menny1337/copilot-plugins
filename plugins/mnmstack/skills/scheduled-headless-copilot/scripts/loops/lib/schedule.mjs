const DEFAULT_ONCE_AND_CALENDAR_GRACE_SECONDS = 300;
const DAY_SCAN_LIMIT = 366;
const SECOND_MS = 1000;

function asDate(value, label) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`${label} must be a valid date`);
    return new Date(value.getTime());
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label} must be a valid date`);
  return date;
}

function midnight(date) {
  const value = new Date(date.getTime());
  value.setHours(0, 0, 0, 0);
  return value;
}

function localCandidate(day, hour, minute) {
  const value = new Date(day.getTime());
  value.setHours(hour, minute, 0, 0);
  return value;
}

function scanCalendar(schedule, from, direction) {
  const start = midnight(from);
  const weekdays = normalizeWeekdays(schedule.weekdays);
  for (let offset = 0; offset <= DAY_SCAN_LIMIT; offset += 1) {
    const day = new Date(start.getTime());
    day.setDate(day.getDate() + offset * direction);
    if (weekdays.length && !weekdays.includes(day.getDay())) continue;
    const candidate = localCandidate(day, schedule.hour, schedule.minute);
    if (direction > 0) {
      if (candidate.getTime() > from.getTime()) return candidate;
    } else if (candidate.getTime() <= from.getTime()) {
      return candidate;
    }
  }
  return null;
}

function isoOrNull(value, label) {
  return value == null ? null : asDate(value, label).toISOString();
}

export function normalizeWeekdays(weekdays) {
  if (!Array.isArray(weekdays)) return [];
  return [...new Set(weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort(
    (left, right) => left - right,
  );
}

export function scheduleGraceSeconds(schedule) {
  if (!schedule || typeof schedule !== "object") throw new TypeError("schedule must be an object");
  if (schedule.kind === "manual") return 0;
  if (schedule.kind === "interval") {
    return Number.isInteger(schedule.graceSeconds) ? schedule.graceSeconds : 0;
  }
  if (schedule.kind === "once" || schedule.kind === "calendar") {
    return Number.isInteger(schedule.graceSeconds)
      ? schedule.graceSeconds
      : DEFAULT_ONCE_AND_CALENDAR_GRACE_SECONDS;
  }
  throw new TypeError(`unsupported schedule kind: ${schedule.kind}`);
}

export function launchdStartSpec(schedule) {
  if (!schedule || typeof schedule !== "object") throw new TypeError("schedule must be an object");
  switch (schedule.kind) {
    case "manual":
      return null;
    case "interval":
      return { key: "StartInterval", value: schedule.seconds };
    case "calendar": {
      const base = { Hour: schedule.hour, Minute: schedule.minute };
      const weekdays = normalizeWeekdays(schedule.weekdays);
      return {
        key: "StartCalendarInterval",
        value: weekdays.length ? weekdays.map((weekday) => ({ ...base, Weekday: weekday })) : base,
      };
    }
    case "once": {
      const scheduledAt = asDate(schedule.scheduledAt, "schedule.scheduledAt");
      return {
        key: "StartCalendarInterval",
        value: {
          Month: scheduledAt.getMonth() + 1,
          Day: scheduledAt.getDate(),
          Hour: scheduledAt.getHours(),
          Minute: scheduledAt.getMinutes(),
        },
      };
    }
    default:
      throw new TypeError(`unsupported schedule kind: ${schedule.kind}`);
  }
}

export function nextCalendarOccurrence(schedule, from = new Date()) {
  if (schedule?.kind !== "calendar") throw new TypeError("schedule.kind must be calendar");
  return scanCalendar(schedule, asDate(from, "from"), 1);
}

export function previousCalendarOccurrence(schedule, from = new Date()) {
  if (schedule?.kind !== "calendar") throw new TypeError("schedule.kind must be calendar");
  return scanCalendar(schedule, asDate(from, "from"), -1);
}

export function assessSchedule(schedule, state = {}, options = {}) {
  if (!schedule || typeof schedule !== "object") throw new TypeError("schedule must be an object");
  const now = asDate(options.now ?? new Date(), "now");
  const baseState = {
    consumedAt: isoOrNull(state.consumedAt, "state.consumedAt"),
    lastScheduledAt: isoOrNull(state.lastScheduledAt, "state.lastScheduledAt"),
    nextExpectedAt: isoOrNull(state.nextExpectedAt, "state.nextExpectedAt"),
  };
  switch (schedule.kind) {
    case "manual":
      return {
        kind: "manual",
        due: false,
        fresh: false,
        stale: false,
        consumed: false,
        reset: false,
        reason: "manual",
        scheduledAt: null,
        nextExpectedAt: null,
        windowClosesAt: null,
        state: baseState,
      };
    case "once": {
      const scheduledAt = asDate(schedule.scheduledAt, "schedule.scheduledAt");
      const scheduledIso = scheduledAt.toISOString();
      const graceMs = scheduleGraceSeconds(schedule) * SECOND_MS;
      const windowClosesAt = new Date(scheduledAt.getTime() + graceMs).toISOString();
      if (baseState.consumedAt) {
        return {
          kind: "once",
          due: false,
          fresh: false,
          stale: false,
          consumed: true,
          reset: false,
          reason: "consumed",
          scheduledAt: scheduledIso,
          nextExpectedAt: null,
          windowClosesAt,
          state: baseState,
        };
      }
      if (now.getTime() < scheduledAt.getTime()) {
        return {
          kind: "once",
          due: false,
          fresh: false,
          stale: false,
          consumed: false,
          reset: false,
          reason: "waiting",
          scheduledAt: scheduledIso,
          nextExpectedAt: scheduledIso,
          windowClosesAt,
          state: baseState,
        };
      }
      const consumedState = { ...baseState, consumedAt: scheduledIso, lastScheduledAt: scheduledIso };
      if (now.getTime() <= scheduledAt.getTime() + graceMs) {
        return {
          kind: "once",
          due: true,
          fresh: true,
          stale: false,
          consumed: true,
          reset: false,
          reason: "due",
          scheduledAt: scheduledIso,
          nextExpectedAt: null,
          windowClosesAt,
          state: consumedState,
        };
      }
      return {
        kind: "once",
        due: false,
        fresh: false,
        stale: true,
        consumed: true,
        reset: false,
        reason: "expired",
        scheduledAt: scheduledIso,
        nextExpectedAt: null,
        windowClosesAt,
        state: consumedState,
      };
    }
    case "calendar": {
      const previous = previousCalendarOccurrence(schedule, now);
      const next = nextCalendarOccurrence(schedule, now);
      const nextExpectedAt = next?.toISOString() ?? null;
      if (!previous) {
        return {
          kind: "calendar",
          due: false,
          fresh: false,
          stale: false,
          consumed: false,
          reset: false,
          reason: "waiting",
          scheduledAt: null,
          nextExpectedAt,
          windowClosesAt: null,
          state: baseState,
        };
      }
      const scheduledIso = previous.toISOString();
      const graceMs = scheduleGraceSeconds(schedule) * SECOND_MS;
      const windowClosesAt = new Date(previous.getTime() + graceMs).toISOString();
      if (baseState.lastScheduledAt === scheduledIso) {
        return {
          kind: "calendar",
          due: false,
          fresh: false,
          stale: false,
          consumed: true,
          reset: false,
          reason: "already-consumed",
          scheduledAt: scheduledIso,
          nextExpectedAt,
          windowClosesAt,
          state: baseState,
        };
      }
      if (now.getTime() <= previous.getTime() + graceMs) {
        return {
          kind: "calendar",
          due: true,
          fresh: true,
          stale: false,
          consumed: false,
          reset: false,
          reason: "due",
          scheduledAt: scheduledIso,
          nextExpectedAt,
          windowClosesAt,
          state: { ...baseState, lastScheduledAt: scheduledIso },
        };
      }
      return {
        kind: "calendar",
        due: false,
        fresh: false,
        stale: true,
        consumed: true,
        reset: false,
        reason: "stale",
        scheduledAt: scheduledIso,
        nextExpectedAt,
        windowClosesAt,
        state: { ...baseState, lastScheduledAt: scheduledIso },
      };
    }
    case "interval": {
      const graceMs = scheduleGraceSeconds(schedule) * SECOND_MS;
      if (!baseState.nextExpectedAt) {
        const nextExpectedAt = new Date(now.getTime() + schedule.seconds * SECOND_MS).toISOString();
        return {
          kind: "interval",
          due: false,
          fresh: false,
          stale: false,
          consumed: false,
          reset: true,
          reason: "initialized",
          scheduledAt: null,
          nextExpectedAt,
          windowClosesAt: null,
          state: { ...baseState, nextExpectedAt },
        };
      }
      const expected = asDate(baseState.nextExpectedAt, "state.nextExpectedAt");
      const scheduledIso = expected.toISOString();
      const windowClosesAt = new Date(expected.getTime() + graceMs).toISOString();
      if (now.getTime() < expected.getTime()) {
        return {
          kind: "interval",
          due: false,
          fresh: false,
          stale: false,
          consumed: false,
          reset: false,
          reason: "waiting",
          scheduledAt: null,
          nextExpectedAt: scheduledIso,
          windowClosesAt,
          state: baseState,
        };
      }
      if (now.getTime() <= expected.getTime() + graceMs) {
        const nextExpectedAt = new Date(expected.getTime() + schedule.seconds * SECOND_MS).toISOString();
        return {
          kind: "interval",
          due: true,
          fresh: true,
          stale: false,
          consumed: false,
          reset: false,
          reason: "due",
          scheduledAt: scheduledIso,
          nextExpectedAt,
          windowClosesAt,
          state: {
            ...baseState,
            lastScheduledAt: scheduledIso,
            nextExpectedAt,
          },
        };
      }
      const nextExpectedAt = new Date(now.getTime() + schedule.seconds * SECOND_MS).toISOString();
      return {
        kind: "interval",
        due: false,
        fresh: false,
        stale: true,
        consumed: false,
        reset: true,
        reason: "wake-skip-reset",
        scheduledAt: scheduledIso,
        nextExpectedAt,
        windowClosesAt,
        state: {
          ...baseState,
          nextExpectedAt,
        },
      };
    }
    default:
      throw new TypeError(`unsupported schedule kind: ${schedule.kind}`);
  }
}

export { DEFAULT_ONCE_AND_CALENDAR_GRACE_SECONDS };
