# Session-Signal Queries

Adaptable queries for the `session_store_sql` tool, used by the **skill-improvement-loop**
skill. They surface *candidate* signals for human review — not proof. Always pair them
with the evidence grading and verdict discipline in `SKILL.md`.

## Backend availability & dialect

The tool may query a cloud store (DuckDB syntax) and/or a local store (SQLite syntax),
and reports a `_query_source` column per row. **The two backends do not expose the same
schema.** If a query references a table or column that the available backend lacks, the
whole query can fail (e.g. when the cloud store returns HTTP 404 and the column is
cloud-only) rather than degrade gracefully. Always confirm a backend is reachable, and
when only the local store responds, restrict yourself to the local-available subset below.

### Observed table availability

Availability varies across CLI versions, so treat this as *observed*, not frozen. Probe
with `SELECT name FROM sqlite_master WHERE type='table'` (local) before relying on it.

| Documented table | Cloud (documented) | Local (observed) | Notes |
|---|:---:|:---:|---|
| `sessions` | yes | yes | local lacks populated `agent_name` / `host_type`; columns: id, cwd, repository, branch, summary, created_at, updated_at |
| `turns` | yes | yes | local lacks event/tool columns; columns: id, session_id, turn_index, user_message, assistant_response, timestamp |
| `session_refs` | yes | yes | commit/pr/issue refs |
| `session_files` | yes | yes | files touched per session (edit/create) |
| `checkpoints` | yes | yes | richer locally |
| `events` | yes | **no** (in SQL) | cloud-only in SQL; **but the full event log is on disk locally** at `~/.copilot/session-state/<id>/events.jsonl` — see *Local deep-validation* below |
| `tool_requests` | yes | **no** (in SQL) | cloud-only in SQL; tool calls are recoverable locally from `events.jsonl` (`tool.execution_start`) |
| `attachments` | yes | **no** | cloud-only in observed environment |

### Dialect rules

| Concern | DuckDB / cloud | SQLite / local |
|---|---|---|
| Time filter | `now() - INTERVAL '30 days'` | `datetime(timestamp) > datetime('now','-30 days')` |
| Case-insensitive match | `ILIKE '%x%'` | `LIKE '%x%'` (case-insensitive for ASCII) |
| Boolean | `col = false` | no boolean literals — column absent locally |
| Timestamp literal | `TIMESTAMP 'YYYY-MM-DD HH:MM:SS'` | plain string `'YYYY-MM-DDTHH:MM:SSZ'` (stored ISO8601), or wrap both sides in `datetime(...)` |
| `agent_name` | available | **not populated locally — do not filter on it** |

Run one statement per call, always add a time filter, always `LIMIT`, and select only the
columns you need. When coverage is local-only, say so explicitly — but before downgrading
any signal's grade, run the **local deep-validation via `events.jsonl`** below. The
`session_store_sql` local DB lacks tool logs, but each session's full event log (assistant
turns, tool calls, successes/failures) lives on disk and is authoritative.

### Local deep-validation via `events.jsonl` (check this BEFORE downgrading)

The `session_store_sql` local store nulls `assistant_response` and lacks `events` /
`tool_requests`, but that is **not** the only local evidence. Every session writes a
complete append-only event log to:

```
~/.copilot/session-state/<session_id>/events.jsonl
```

This file is a high-fidelity local record of **what the agent actually did** — assistant
messages, every tool call with its arguments, and each call's success/failure. Consult it to
*confirm or refute* a candidate signal before grading. With `events.jsonl` in hand, a
**tool-error signal can be direct evidence**, and a missed-trigger can be established more
firmly (see grading caveat below).

**Validate the log before trusting it.** `events.jsonl` is authoritative *when it is
complete and parses cleanly* — but it can be missing, truncated mid-session (active or
crashed runs), partially written, pruned, or written by a different CLI version whose schema
drifted. Before relying on it: confirm the file exists; parse line-by-line and note any lines
that fail to parse (don't silently skip them); confirm the expected event types are present
and the timestamps/ordering actually cover the turn you care about; and tolerate `data`-shape
changes (fall back gracefully if a field is absent). If the log is incomplete or doesn't
cover the target turn, treat it as *inconclusive* and fall back to the downgrade rule below.

Event types you will use most:

| `type` | Key fields under `data` | Use |
|---|---|---|
| `user.message` | `content` | Anchor on the correction/request turn |
| `assistant.message` | `content`, `toolRequests[].name`, `toolRequests[].arguments`, `toolRequests[].intentionSummary` | What the agent said and which tools it *requested* (intent, not proof of execution) |
| `tool.execution_start` | `toolName`, `arguments`, `toolCallId` | The tool that **actually ran** + its args (e.g. did it `attach` or `open --profile`?) — this is the authoritative "what happened" |
| `tool.execution_complete` | `toolCallId`, `success` (bool), `result.content` | Did that call succeed or fail? Join to the start event by `toolCallId` |
| `skill.invoked` | `name`, `path` | Which skill actually loaded (proves a trigger *fired*; absence is discussed under grading) |

> **Requested ≠ executed.** `assistant.message.toolRequests` is the agent's *intent*; only
> `tool.execution_start` proves a tool *ran*, and only `tool.execution_complete.success`
> proves the outcome. Grade behavior on the execution events, not the requests.

Extraction recipe — anchor on the relevant user turn, then print the surrounding assistant
messages and the **executed** tool calls (joined to their completion). It fails loudly if the
anchor is missing or ambiguous, so you never validate the wrong turn. The 40-event window is
for human-readable context only — for *absence* claims use the full-session scan below it.

```bash
python3 - "$HOME/.copilot/session-state/<SESSION_ID>/events.jsonl" "<anchor substring>" << 'PY'
import json, sys
F, needle = sys.argv[1], sys.argv[2].lower()
evs, bad = [], 0
for ln in open(F):
    if ln.strip():
        try: evs.append(json.loads(ln))
        except json.JSONDecodeError: bad += 1
if bad: print(f"WARNING: {bad} unparseable line(s) — log may be truncated/incomplete")
d = lambda e: e.get('data', e)
hits = [i for i,e in enumerate(evs)
        if e.get('type')=='user.message' and needle in (d(e).get('content','') or '').lower()]
if not hits:
    sys.exit(f"ANCHOR NOT FOUND: no user.message matches {needle!r} — refine the substring")
if len(hits) > 1:
    print(f"WARNING: anchor matched {len(hits)} user turns at {hits}; using the first. Refine for uniqueness.")
anchor = hits[0]
# map toolCallId -> success so executed calls show their outcome inline
done = {d(e).get('toolCallId'): d(e).get('success') for e in evs if e.get('type')=='tool.execution_complete'}
for e in evs[anchor:anchor+40]:
    t, data = e.get('type'), d(e)
    if t=='user.message':
        print(f"\nUSER: {(data.get('content') or '')[:200]}")
    elif t=='assistant.message':
        c=(data.get('content') or '').strip()
        if c: print(f"  ASST: {c[:240]}")
    elif t=='tool.execution_start':                      # what ACTUALLY ran
        a=data.get('arguments') or {}
        cid=data.get('toolCallId')
        print(f"     >>> RAN {data.get('toolName')}: {(a.get('command') or json.dumps(a))[:160]}  [success={done.get(cid)}]")
PY
```

For an **absence / missed-trigger claim** ("the skill/tool never ran"), the 40-event window is
not enough — scan the whole session (and bound it from the anchor user turn through the next
user turn or session end) for the relevant `skill.invoked` names and `tool.execution_start`
tool names, since the invocation may fall outside the window or use a related name:

```bash
python3 - "$HOME/.copilot/session-state/<SESSION_ID>/events.jsonl" << 'PY'
import json, sys, collections
evs=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
d=lambda e:e.get('data',e)
skills=collections.Counter(d(e).get('name') for e in evs if e.get('type')=='skill.invoked')
tools=collections.Counter(d(e).get('toolName') for e in evs if e.get('type')=='tool.execution_start')
print("skills invoked (whole session):", dict(skills))
print("tools executed (whole session):", dict(tools))
PY
```

This is what separates a confirmed root cause from a guess: an `assistant.message` saying
"let me launch the browser" followed by a `tool.execution_start` with `toolName: bash`,
`arguments.command: playwright-cli open --profile=...` proves the agent *ran* a launch rather
than an attach — a discovery/procedure signal graded **direct**. Beware false positives the
transcript text alone would miss: a `computer-use-request_access` call whose follow-up shows
the **user declined** is a permission/tool-layer issue, not a skill miss — `events.jsonl` is
how you tell them apart.

### Grading with `events.jsonl`

- **Tool errors/failures** — `events.jsonl` is **direct** evidence: `tool.execution_start`
  shows the call, `tool.execution_complete.success` shows the outcome.
- **What the agent did** (launch vs attach, which tool/args) — **direct**, read from
  `tool.execution_start`.
- **Missed trigger** — `events.jsonl` can *directly* establish "no invocation or tool trace
  found in the inspected scope" (after a full-session scan, not just the window). But the
  conclusion that the skill *should* have triggered and wrongly didn't remains **inferred** —
  grade it **strong-inferred at best**, and only **direct** when the user explicitly said the
  skill should have been used. Absence of `skill.invoked` is not, by itself, proof of a miss.

### Local-only confidence downgrade (applies only when `events.jsonl` is unavailable or inconclusive)

When you genuinely cannot inspect `events.jsonl` (file absent, pruned, truncated, or it does
not cover the target turn):

- **User corrections** (from `turns.user_message`) can still be **direct**, high-trust signals.
- **Tool error/retry** and **missed-trigger** signals can be at most **weak-inferred** — they
  rest on transcript text, not tool logs.
- **Never conclude "the skill/tool was not used"** from the `session_store_sql` documented
  tables alone; absence of a trace in `turns`/`session_files` is not proof of absence — check
  `events.jsonl` first.

## Step 0 — Evidence coverage

Record the scope of what you scanned before drawing conclusions.

```sql
-- DuckDB form; SQLite: replace the INTERVAL expression
SELECT COUNT(*) AS sessions_scanned,
       MIN(created_at) AS earliest,
       MAX(created_at) AS latest
FROM sessions
WHERE created_at > now() - INTERVAL '30 days';
```

```sql
-- SQLite / local form
SELECT COUNT(*) AS sessions_scanned,
       MIN(created_at) AS earliest,
       MAX(created_at) AS latest
FROM sessions
WHERE datetime(created_at) > datetime('now','-30 days');
```

## Harvest queries (Phase A)

### User corrections / pushback (high-trust signal)

```sql
SELECT session_id, turn_index, substr(user_message, 1, 200) AS msg, timestamp
FROM turns
WHERE timestamp > now() - INTERVAL '30 days'
  AND (
    user_message ILIKE '%no, %' OR user_message ILIKE '%that''s wrong%'
    OR user_message ILIKE '%you should have%' OR user_message ILIKE '%why didn''t you%'
    OR user_message ILIKE '%not what i%' OR user_message ILIKE '%instead%'
  )
ORDER BY timestamp DESC
LIMIT 50;
```

```sql
-- SQLite / local form (LIKE is case-insensitive for ASCII)
SELECT session_id, turn_index, substr(user_message, 1, 200) AS msg, timestamp
FROM turns
WHERE datetime(timestamp) > datetime('now','-30 days')
  AND (
    user_message LIKE '%no, %' OR user_message LIKE '%that''s wrong%'
    OR user_message LIKE '%you should have%' OR user_message LIKE '%why didn''t you%'
    OR user_message LIKE '%not what i%' OR user_message LIKE '%instead%'
  )
ORDER BY timestamp DESC
LIMIT 50;
```

### Tool error / retry clusters

**Cloud only** — requires the `events` table. Absent from the local store.

```sql
SELECT tool_start_name, COUNT(*) AS failures
FROM events
WHERE timestamp > now() - INTERVAL '30 days'
  AND type = 'tool.execution_complete'
  AND tool_complete_success = false
GROUP BY tool_start_name
ORDER BY failures DESC
LIMIT 20;
```

**Local fallback.** The `session_store_sql` local store has no tool logs, so the SQL below
can only surface *candidate* error/retry turns from transcript text — it catches narrated
errors but produces false positives (quoted errors, explanations, planned retries) and
misses silent failures. Use it only to **find candidate sessions**, then open each
session's `events.jsonl` (see *Local deep-validation* above) and read the actual
`tool.execution_complete` `success` flags. With `events.jsonl` you can measure real
per-tool success/failure locally and grade the signal **direct**; without it, every SQL hit
is a **weak-inferred candidate** and must not be presented as a tool-failure rate.

```sql
-- SQLite / local: candidate error/retry turns — NOT a failure count
SELECT session_id, turn_index, substr(assistant_response, 1, 200) AS snippet, timestamp
FROM turns
WHERE datetime(timestamp) > datetime('now','-30 days')
  AND (
    assistant_response LIKE '%error%' OR assistant_response LIKE '%failed%'
    OR assistant_response LIKE '%retry%' OR assistant_response LIKE '%permission denied%'
    OR assistant_response LIKE '%timed out%' OR assistant_response LIKE '%rate limit%'
  )
ORDER BY timestamp DESC
LIMIT 50;
```

### Missed-trigger candidates (treat as candidates, then grade)

There is no log line for a skill that never fired, so this is inference. Start from the
skill's own description keywords, find sessions whose user messages match, then check
whether the skill's procedure/tools appear in that session.

```sql
-- 1) Sessions whose tasks resemble the target skill's purpose.
--    Replace the ILIKE terms with keywords from the skill's description.
--    SQLite/local: use LIKE and datetime(t.timestamp) > datetime('now','-30 days').
SELECT DISTINCT t.session_id, MIN(t.timestamp) AS first_seen
FROM turns t
WHERE t.timestamp > now() - INTERVAL '30 days'
  AND (t.user_message ILIKE '%KEYWORD_A%' OR t.user_message ILIKE '%KEYWORD_B%')
GROUP BY t.session_id
LIMIT 50;
```

```sql
-- 2) For a candidate session, list the tools actually used (cloud only — tool_requests).
--    If the skill's expected tools/steps are absent, it is a strong-inferred miss.
SELECT name, COUNT(*) AS calls
FROM tool_requests
WHERE session_id = 'SESSION_ID_HERE'
GROUP BY name
ORDER BY calls DESC;
```

**Local mode:** `tool_requests` (and `events`) are absent from the `session_store_sql` local
DB, so *SQL alone* cannot enumerate tool calls. But the tool calls **are** on disk — open
the session's `events.jsonl` (see *Local deep-validation* above) and enumerate
`tool.execution_start` `toolName`/`arguments` directly, using the full-session scan for
absence claims. That gives a **direct** read of *what ran*; the conclusion that a trigger was
*missed* (should have fired but didn't) is still inferred, so grade a missed-trigger
**strong-inferred at best** — **direct** only when the user explicitly said the skill should
have been used. Only when `events.jsonl` is unavailable do you fall back to
`assistant_response`/`session_files` traces capped at **weak-inferred**. Never conclude "the
tool was not used" from the absence of a local SQL trace without scanning `events.jsonl`.

```sql
-- SQLite / local: files touched in a candidate session (partial procedure trace)
SELECT file_path, tool_name, turn_index
FROM session_files
WHERE session_id = 'SESSION_ID_HERE'
ORDER BY turn_index;
```

> **Advanced escape hatch (internal, may change).** Some local stores contain undocumented
> `cst_*` tables (e.g. `cst_tool_invocations`) that record tool calls. These are
> implementation details: probe the schema first, do not assume availability or stability,
> and do not base durable skill-improvement evidence solely on them.

Grade each candidate: **direct** (user said so) > **strong-inferred** (match + no trace +
bad outcome) > **weak-inferred** (keyword only — manual inspection, never edit alone).

### Inspect a single session end-to-end

The SQL below shows the user turns, but the local `session_store_sql` store **nulls
`assistant_response`** — so for full fidelity (assistant reasoning + every tool call +
success/failure) read the session's `events.jsonl` with the *Local deep-validation* recipe
above. Treat `events.jsonl` as the source of truth for what the agent actually did; use the
SQL only for a quick user-turn skim or when the event log is unavailable.

```sql
SELECT turn_index, substr(user_message,1,200) AS user_msg,
       substr(assistant_response,1,200) AS assistant_msg, timestamp
FROM turns
WHERE session_id = 'SESSION_ID_HERE'
ORDER BY turn_index;
```

## Re-review queries (Phase E)

Use the **change date** recorded in the changelog entry as the boundary. Compare a
post-change window against the pre-change baseline window and record both sample counts.

```sql
-- Post-change occurrences of the target signal (example: the correction signal).
SELECT COUNT(*) AS post_change_hits
FROM turns
WHERE timestamp > TIMESTAMP 'YYYY-MM-DD HH:MM:SS'   -- change date
  AND (user_message ILIKE '%you should have%' OR user_message ILIKE '%why didn''t you%');
```

```sql
-- SQLite / local form. Stored timestamps are ISO8601 (e.g. 2026-02-18T11:01:05.240Z);
-- compare with datetime() on both sides so formats normalize.
SELECT COUNT(*) AS post_change_hits
FROM turns
WHERE datetime(timestamp) > datetime('YYYY-MM-DD HH:MM:SS')   -- change date
  AND (user_message LIKE '%you should have%' OR user_message LIKE '%why didn''t you%');
```

```sql
-- Pre-change baseline over a comparable window before the change date.
SELECT COUNT(*) AS pre_change_hits
FROM turns
WHERE timestamp BETWEEN TIMESTAMP 'BASELINE_START' AND TIMESTAMP 'CHANGE_DATE'
  AND (user_message ILIKE '%you should have%' OR user_message ILIKE '%why didn''t you%');
```

```sql
-- SQLite / local form.
SELECT COUNT(*) AS pre_change_hits
FROM turns
WHERE datetime(timestamp) BETWEEN datetime('BASELINE_START') AND datetime('CHANGE_DATE')
  AND (user_message LIKE '%you should have%' OR user_message LIKE '%why didn''t you%');
```

If the post-change sample is below ~3–5 relevant sessions, the verdict is
**Insufficient evidence** — keep monitoring and set a new review-due date. Always check
the confounders listed in `SKILL.md` before assigning any verdict, and never phrase the
result as causal.
