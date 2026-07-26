# Copilot Hooks Reference — Payloads, Decisions, Tool Names

Companion to `SKILL.md`. Load this when writing a hook that parses the event payload or
returns JSON to control behavior. Source: GitHub Copilot hooks reference (docs.github.com).

## Contents

- [Payload formats](#payload-formats)
- [Event input payloads](#event-input-payloads)
- [Decision / output schemas](#decision--output-schemas)
- [Tool names for matchers](#tool-names-for-matchers)
- [Exit codes](#exit-codes)

## Payload formats

Every event delivers a JSON payload to the hook (on stdin for command hooks, as the POST body
for http hooks). Two formats, selected by how you write the event name:

- **camelCase event name** (e.g. `sessionStart`) → payload fields are camelCase, `timestamp`
  is a Unix milliseconds number.
- **PascalCase event name** (e.g. `SessionStart`, `PreToolUse`, `Stop`) → VS Code-compatible
  payload, fields are snake_case, includes `hook_event_name`, `timestamp` is an ISO 8601 string.

All payloads include `sessionId`/`session_id`, `timestamp`, and `cwd`.

## Event input payloads

camelCase shapes shown; PascalCase equivalents use snake_case keys plus `hook_event_name`.

| Event | Extra fields beyond `sessionId`, `timestamp`, `cwd` |
|-------|-----------------------------------------------------|
| `sessionStart` | `source: "startup"\|"resume"\|"new"`, `initialPrompt?` |
| `sessionEnd` | `reason: "complete"\|"error"\|"abort"\|"timeout"\|"user_exit"` |
| `userPromptSubmitted` | `prompt` |
| `userPromptTransformed` | `prompt`, `transformedPrompt` — fires after the prompt is transformed (e.g. by `userPromptSubmitted` context injection). Output may set `modifiedTransformedPrompt`. No PascalCase alias. |
| `preToolUse` | `toolName`, `toolArgs` |
| `preMcpToolCall` | `toolName`, `toolArgs` for MCP tool calls specifically. No PascalCase alias. |
| `permissionRequest` | `toolName`, `toolArgs` (CLI only; fires before the permission service) |
| `postToolUse` | `toolName`, `toolArgs`, `toolResult: { resultType: "success", textResultForLlm }` |
| `postToolUseFailure` | `toolName`, `toolArgs`, `error` |
| `agentStop` | `transcriptPath`, `stopReason: "end_turn"`, `stop_hook_active` (PascalCase event name is `Stop`) |
| `subagentStart` | `transcriptPath`, `agentName`, `agentDisplayName?`, `agentDescription?` |
| `subagentStop` | `transcriptPath`, `agentName`, `agentDisplayName?`, `stopReason: "end_turn"` |
| `errorOccurred` | `error: {message,name,stack?}`, `errorContext: "model_call"\|"tool_execution"\|"system"\|"user_input"`, `recoverable` |
| `preCompact` | `transcriptPath`, `trigger: "manual"\|"auto"`, `customInstructions` |
| `notification` | `hook_event_name: "Notification"`, `message`, `title?`, `notification_type` |

> The built-in `general-purpose` agent does not emit `subagentStart` / `subagentStop`.

### `notification_type` values

`shell_completed`, `shell_detached_completed`, `agent_completed`, `agent_idle`,
`permission_prompt`, `elicitation_dialog`.

## Decision / output schemas

Write a single-line JSON object to stdout (command) or the response body (http), exit `0`.
Return `{}` or empty to take the default action.

> **Exactly one final object.** stdout is scanned line-by-line: any single-line
> `{"type":"progress","message":"...","temporary"?:true}` object is consumed as a display-only
> progress event and stripped. Everything else is concatenated and parsed with one `JSON.parse`,
> so emit only **one** final decision object — two concatenate into invalid JSON and are ignored.
> `timeout` is accepted as an alias for `timeoutSec` on `command` and `http` entries.

### `preToolUse`

| Field | Values | Notes |
|-------|--------|-------|
| `permissionDecision` | `"allow"` / `"deny"` / `"ask"` | Empty → default. Cloud agent treats `"ask"` as `"deny"`. |
| `permissionDecisionReason` | string | **Required** when `deny`; shown to the agent. |
| `modifiedArgs` | object | Substitute tool arguments. |

### `permissionRequest` (CLI only)

Fires before the permission service (rules, session approvals, auto-allow/deny, prompting).
`allow`/`deny` short-circuits it. Useful in `-p`/CI where no interactive prompt exists.

| Field | Values | Notes |
|-------|--------|-------|
| `behavior` | `"allow"` / `"deny"` | Empty → fall through to normal flow. |
| `message` | string | Reason fed to the LLM on deny. |
| `interrupt` | boolean | `true` + `deny` stops the agent entirely. |

For command hooks, exit `2` ⇒ `{"behavior":"deny"}` (stdout JSON merged in).

### `postToolUse`

| Field | Type | Notes |
|-------|------|-------|
| `modifiedResult` | object | Replacement result; must be `{ resultType: "success", textResultForLlm }`. A `"failure"` routes to `postToolUseFailure`. |
| `additionalContext` | string | Appended after tool output, same turn. Multiple hooks joined with `\n\n`, capped at 10 KB. |

### `agentStop` / `subagentStop`

| Field | Values | Notes |
|-------|--------|-------|
| `decision` | `"block"` / `"allow"` | `"block"` forces another turn using `reason` as the prompt. |
| `reason` | string | Prompt for the forced next turn. |

The CLI ends the turn after **8 consecutive blocks** and warns. Read `stop_hook_active` from
the payload — it is true when this turn only exists because a previous invocation blocked —
and return `{}` instead of blocking again.

### `sessionStart` / `subagentStart` / `notification`

`{ "additionalContext": "..." }` — injected into the session (for `subagentStart`, prepended
to the subagent's prompt; cannot block creation).

## Tool names for matchers

Match `preToolUse` / `permissionRequest` against these native `toolName` values:

`ask_user`, `bash`, `create`, `edit`, `glob`, `grep`, `powershell`, `task`, `update_todo`,
`view`, `web_fetch`, `web_search`.

Native matchers are anchored `^(?:pattern)$` and must match the full tool name.

### Claude-format matchers (PascalCase `PreToolUse`)

Hooks configured with the **PascalCase** event name `PreToolUse` (as used by Claude Code
plugins and the Open Plugins format) use Claude matcher semantics instead, and the payload
reports `tool_name` as the **Claude tool name** (e.g. `Bash`, not `bash`):

- `*`, `**`, or empty `matcher` → fires for every tool.
- A literal name or `|`-alternation (e.g. `Bash` or `Edit|Write`) → fires when a token equals
  the runtime tool name or its Claude name below.
- Anything else → case-sensitive regex anchored `^(?:PATTERN)$` against the Claude name.

| Runtime tool | Claude tool name |
|--------------|------------------|
| `bash`, `powershell` | `Bash` |
| `view` | `Read` |
| `create` | `Write` |
| `edit`, `str_replace_editor`, `apply_patch` | `Edit` |
| `grep`, `rg` | `Grep` |
| `glob` | `Glob` |
| `web_fetch` | `WebFetch` |
| `web_search` | `WebSearch` |
| `ask_user` | `AskUserQuestion` |
| `update_todo` | `TodoWrite` |

## Exit codes

| Exit code | Meaning |
|-----------|---------|
| `0` | Success. `stdout` parsed as decision JSON if present. |
| `2` | `preToolUse` and `permissionRequest`: treated as **deny**. `postToolUseFailure`: treated as `additionalContext`. Otherwise a warning (`stderr` surfaced, run continues). |
| other non-zero | `preToolUse`: **denies the tool call** (hook errors fail closed since CLI 1.0.57). Every other event logs the failure and the run continues (**fail-open**). |

A hook that *times out* does not block the tool call (CLI 1.0.67) — only explicit denials and
`preToolUse` errors do.

If multiple hooks of the same type fire, they run in order; for `preToolUse` any `deny` blocks
the tool. Later hook outputs override earlier ones when merged.
