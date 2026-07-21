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
| `preToolUse` | `toolName`, `toolArgs` |
| `postToolUse` | `toolName`, `toolArgs`, `toolResult: { resultType: "success", textResultForLlm }` |
| `postToolUseFailure` | `toolName`, `toolArgs`, `error` |
| `agentStop` | `transcriptPath`, `stopReason: "end_turn"` (PascalCase event name is `Stop`) |
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

### `sessionStart` / `subagentStart` / `notification`

`{ "additionalContext": "..." }` — injected into the session (for `subagentStart`, prepended
to the subagent's prompt; cannot block creation).

## Tool names for matchers

Match `preToolUse` / `permissionRequest` against these `toolName` values:

`ask_user`, `bash`, `create`, `edit`, `glob`, `grep`, `powershell`, `task`, `view`, `web_fetch`.

(Matchers are anchored `^(?:pattern)$` and must match the full tool name.)

## Exit codes

| Exit code | Meaning |
|-----------|---------|
| `0` | Success. `stdout` parsed as decision JSON if present. |
| `2` | Warning by default (`stderr` surfaced, run continues). `permissionRequest`: treated as `deny`. `postToolUseFailure`: treated as `additionalContext`. |
| other non-zero | Logged as a hook failure; run continues (**fail-open**). |

If multiple hooks of the same type fire, they run in order; for `preToolUse` any `deny` blocks
the tool. Later hook outputs override earlier ones when merged.
