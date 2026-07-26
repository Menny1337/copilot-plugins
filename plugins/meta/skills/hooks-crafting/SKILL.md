---
name: hooks-crafting
description: "Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications, matchers, and security."
user-invocable: false
compatibility: "GitHub Copilot CLI or Copilot cloud agent; lifecycle events and payloads vary by host."
---

# How to Create and Configure Hooks

A practical workflow for authoring Copilot hooks — shell/HTTP/prompt handlers that run at
key points in the agent lifecycle (`hooks.json`).

Hook decision and exit-code semantics have changed several times. Verify version-sensitive
behaviour against `../agent-skill-audit/references/cli-feature-baseline.md` before relying
on memory.

## When to Use

- Creating or editing a `hooks.json` (plugin, repo, or user level)
- Running a command at session start/end, before/after a tool, or when the agent stops
- Programmatically allowing, denying, or modifying a tool call
- Injecting extra context, logging, notifications, or recovery guidance into a session
- Troubleshooting a hook that isn't firing, is timing out, or outputs invalid JSON

## When to Skip

- Creating or modifying skills — use `skill-crafting`
- Creating or modifying agents — use `agent-crafting`
- Packaging hooks into a plugin or marketplace — use `plugin-crafting`
- Auditing an existing agent/skill/hook system for quality — use `agent-skill-audit`
- The `hooks` *frontmatter field* on a Claude Code skill — that is a different, host-specific
  feature and is **not** the same as the `hooks.json` system described here

## Hook System Basics

A hook is an external action (a shell command, an HTTP POST, or an auto-submitted prompt)
that Copilot runs when a lifecycle **event** fires. Hooks are declared in JSON files with
`version: 1` and a `hooks` object keyed by event name.

### Locations and load order

Hooks are loaded from these sources and **combined** in this order — **policy → user →
project → plugins** (when the same event appears in multiple sources, all entries run):

| Source | Path | Scope |
|--------|------|-------|
| **Policy hooks** (CLI only) | `/etc/github-copilot/policy.d/*.json` (Linux/macOS), `C:\ProgramData\GitHub\Copilot\policy.d\*.json` or `HKLM\Software\Policies\GitHub\Copilot` (Windows) | Machine-wide, admin-installed |
| User hook files | `~/.copilot/hooks/*.json` (or `$COPILOT_HOME/hooks/`) | Personal, all repos |
| Repository hook files | `.github/hooks/*.json` | Committed, repo-wide |
| User settings inline | `hooks` field in `~/.copilot/settings.json` | Personal |
| Repo settings inline | `hooks` field in `.github/copilot/settings.json` / `settings.local.json` | Committed / local |
| Cross-tool settings | `.claude/settings.json` / `.claude/settings.local.json` | Compatibility |
| Plugin hooks | `<plugin-dir>/hooks/hooks.json` (or a `hooks.json` referenced from `plugin.json`) | Loaded when the plugin is installed |

> **Policy hooks** are loaded by administrators before all other hooks, **cannot** be
> disabled by `disableAllHooks`, and run regardless of folder-trust state. On POSIX they
> must be owned by root and not group/world-writable. Treat them as out of scope for normal
> plugin/repo authoring — they exist so enterprise IT can enforce machine-wide gates.

> **In this marketplace:** plugins ship hooks at `plugins/<plugin>/hooks/hooks.json` and
> declare `"hooks": "hooks/hooks.json"` (the **file path**, not the bare `hooks` dir) in
> `plugin.json`. The CLI `readFile()`s this path at load time, so a directory throws `EISDIR`
> and the plugin fails to load — `validate.mjs` rejects the directory form. `catalog.mjs`
> indexes each hook. Regenerate the catalog after any hook change.

> **Precedence caveat:** sources are combined rather than strictly overriding each other, and
> exact merge ordering can be subtle. Don't rely on one source silently overriding another —
> verify against runtime behavior before depending on ordering. To disable a file's hooks
> without deleting it, set `"disableAllHooks": true` at the top level of that file — note this
> does **not** affect policy hooks, which always load.

### The three hook types

| Type | What it does | Key fields | Allowed on |
|------|--------------|------------|-----------|
| `command` (default) | Runs a shell script/command | `bash`, `powershell`, `command`, `cwd`, `env`, `timeoutSec` (`timeout` alias) | All events |
| `http` | POSTs the event payload as JSON to a URL | `url`, `headers`, `allowedEnvVars`, `timeoutSec` (`timeout` alias) | All events |
| `prompt` | Auto-submits text/slash-command as if typed | `prompt` | `sessionStart` only (new interactive sessions) |

**Command hooks** must set at least one of `bash`, `powershell`, or `command`. Provide both
`bash` (macOS/Linux) and `powershell` (Windows) for cross-platform parity, or use `command`
as a cross-platform fallback — `command` is copied into both `bash` and `powershell` when
those are absent, and an explicit `bash`/`powershell` wins on its own platform. Default
`timeoutSec` is `30` (`timeout` is accepted as an alias; `timeoutSec` wins if both are set).

**HTTP hooks** must set `url`. Only `https://` is allowed, except `http://localhost`/`127.*`/
`[::1]` when `COPILOT_HOOK_ALLOW_LOCALHOST=1`. For `preToolUse` and `permissionRequest` the
URL **must** be `https://` because the response can grant tool permissions.

**Prompt hooks** don't fire on resume or in non-interactive `-p` mode.

### Minimal example

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "echo \"Session started: $(date)\" >> logs/session.log",
        "powershell": "Add-Content -Path logs/session.log -Value \"Session started: $(Get-Date)\"",
        "cwd": ".",
        "timeoutSec": 10
      }
    ]
  }
}
```

## Lifecycle Events

Pick the event by *when* you need to act. Full payloads and decision schemas are in
[`references/hooks-reference.md`](references/hooks-reference.md) — read it before writing a
hook that returns JSON to control behavior.

| Event | Fires when | Can control behavior? |
|-------|-----------|-----------------------|
| `sessionStart` | A new or resumed session begins | Inject `additionalContext` |
| `sessionEnd` | The session terminates | No |
| `userPromptSubmitted` | The user submits a prompt | Inject `additionalContext`, or answer directly and skip the model (CLI only — the cloud agent fires it but ignores the output) |
| `userPromptTransformed` | After the prompt has been transformed | Replace it via `modifiedTransformedPrompt` |
| `preToolUse` | Before each tool executes | Allow / deny / modify args |
| `preMcpToolCall` | Before an MCP tool call specifically | Allow / deny / modify args |
| `postToolUse` | After a tool succeeds | Modify result / inject context |
| `postToolUseFailure` | After a tool fails | Recovery `additionalContext` |
| `permissionRequest` | Before the permission service runs (CLI only) | Allow / deny programmatically |
| `agentStop` | The main agent finishes a turn | `block` to force another turn |
| `subagentStart` | A subagent is spawned | Prepend `additionalContext` |
| `subagentStop` | A subagent finishes | `block` to force another turn |
| `errorOccurred` | An error occurs | No |
| `preCompact` | Before context compaction | No |
| `notification` | CLI emits a system notification (CLI only) | Inject `additionalContext` |

> **Two surfaces.** These events are the full **Copilot CLI** set. Hooks also run in the
> **Copilot cloud agent** sandbox, where a subset fires (no `notification`; `preCompact` only
> with `trigger: "auto"`; `preToolUse` `"ask"` is treated as `"deny"`), only `.github/hooks/*.json`
> is read, and only `bash`/`command` entries are honored (no `powershell`, no user/plugin hooks).
> Keep cloud-agent hooks self-contained and send output over `http` since the sandbox is ephemeral.

> **Aliases are not mechanical.** Most events also accept a Claude/VS Code-compatible
> **PascalCase** name that selects a `snake_case` payload — but the mapping is *not* simple
> re-casing. `userPromptSubmitted` → **`UserPromptSubmit`** and `agentStop` → **`Stop`**;
> `UserPromptSubmitted` and `AgentStop` are **not** recognised and such a hook silently never
> fires. `userPromptTransformed` and `preMcpToolCall` have no alias at all. Pick one
> convention per hook and match the payload format you parse.

### Matchers

`notification`, `permissionRequest`, `preCompact`, `preToolUse`, `postToolUse`, and
`subagentStart` accept an optional `matcher` regex (anchored as `^(?:pattern)$`) that filters
which invocations fire the hook — matched against `notification_type`; `toolName` for
`permissionRequest`; `trigger`; `toolName` for `preToolUse` and `postToolUse` (honored since
CLI 1.0.63, previously dropped silently); and `agentName`, respectively. Invalid regexes cause
the entry to be skipped.

> **Claude-format `preToolUse` matchers differ.** A hook configured with the **PascalCase**
> event name `PreToolUse` (Claude Code / Open Plugins format) uses Claude matcher semantics
> (`*`/`**`/empty → every tool; literal or `|`-alternation; else anchored regex) against the
> **Claude tool name** (e.g. `Bash`, not `bash`). See the reference for the full mapping.

## Decision Control (hooks that change behavior)

Command hooks emit a decision by writing a single-line JSON object to **stdout** and exiting
`0`. HTTP hooks return the JSON in the response body. Summary (see the reference for fields):

- **`preToolUse`** → `{ "permissionDecision": "allow"|"deny"|"ask", "permissionDecisionReason": "...", "modifiedArgs": {...} }`. `permissionDecisionReason` is required for `deny`.
- **`permissionRequest`** → `{ "behavior": "allow"|"deny", "message": "...", "interrupt": true }`. CLI only; short-circuits the normal permission flow. Returning empty falls through to normal handling.
- **`postToolUse`** → `{ "modifiedResult": {...}, "additionalContext": "..." }`. Return `{}` to keep the original result.
- **`agentStop` / `subagentStop`** → `{ "decision": "block"|"allow", "reason": "<prompt for next turn>" }`.
- **`userPromptSubmitted`** → `{ "additionalContext": "..." }` to add context, or a direct response to handle the request without a model call.
- **`sessionStart` / `subagentStart` / `notification`** → `{ "additionalContext": "..." }`.

> **`agentStop` blocking is capped.** A hook that always blocks no longer loops forever: the
> CLI force-ends the turn after **8 consecutive blocks** and warns. The `agentStop` payload
> carries `stop_hook_active` — true when the turn is already continuing because of a previous
> block. Check it and stop blocking, rather than relying on the cap:
>
> ```bash
> [ "$(jq -r '.stop_hook_active // false')" = "true" ] && { echo '{}'; exit 0; }
> ```
>
> An `agentStop` hook that only reports and never blocks (always `echo '{}'; exit 0`) needs no
> such guard — that is the safest default for observability hooks.

> **Emit exactly one final decision object.** The CLI strips recognized progress lines (below)
> from stdout, then concatenates and `JSON.parse`s everything that remains as a single object.
> Two separate JSON objects on stdout concatenate into invalid JSON and are ignored — so the
> hook silently falls through to default behavior.

### Progress messages (command hooks)

A command hook can stream status lines to the CLI timeline while it runs by writing a
single-line JSON object **before** its final decision output:

```bash
echo '{"type": "progress", "message": "Checking policy...", "temporary": true}'
# ... do work ...
echo '{"permissionDecision": "allow"}'
```

Each progress object must be valid JSON on its own line. Add `"temporary": true` for a
transient line that's replaced by the next one and cleared when the assistant responds.
Progress messages are display-only — they're removed from the output stream and never reach
the decision parser.

### Exit codes (command hooks)

| Exit code | Meaning |
|-----------|---------|
| `0` | Success. `stdout` parsed as decision JSON if present. |
| `2` | Special: **denies** for `preToolUse` and `permissionRequest` (stdout merged); `additionalContext` for `postToolUseFailure`; a surfaced warning otherwise (run continues). |
| other non-zero | `preToolUse` **denies the tool call**. Every other event logs the failure and the run continues. |

> **"Hooks fail open" is no longer true across the board.** It still holds for most events, but
> `preToolUse` now fails **closed**: exit code `2` denies (CLI 1.0.70), and a hook *error* denies
> rather than silently allowing (CLI 1.0.57). A flaky or slow `preToolUse` hook will therefore
> block real work — keep it fast, deterministic, and dependency-free. Hook *timeouts* are the
> exception: since 1.0.67 the tool call continues when a hook times out.

## Step-by-Step: Create a Hook

1. **Pick the event** by *when* you need to act (table above).
2. **Pick the type** — `command` for local automation, `http` for sending payloads to a
   service, `prompt` for auto-submitting a starter prompt at `sessionStart`.
3. **Choose a location** — plugin `hooks/hooks.json` for marketplace plugins; `.github/hooks/`
   for repo-wide; `~/.copilot/hooks/` for personal.
4. **Write the entry.** For command hooks include both `bash` and `powershell` (or `command`).
   Keep stdout to a single compact JSON line if the hook returns a decision.
5. **Set a sensible `timeoutSec`.** Keep it tight; hooks block the relevant step until they
   return or time out.
6. **Make scripts executable** (`chmod +x`) with a proper shebang (`#!/usr/bin/env bash`).
7. **Test locally** by piping a sample payload (see reference) into the script and checking the
   exit code and that stdout is valid JSON (`./hook.sh | jq .`).
8. **Reload** — hook config is read at CLI startup; restart the CLI to apply changes.
9. **Regenerate the catalog** if this is a marketplace plugin hook (`node scripts/catalog.mjs`).

## Security and Reliability

- **Hooks are not a hard security boundary.** Failures on most events are **fail-open** (the
  run continues), so a gate that errors may not have denied anything. The exception is
  `preToolUse`, which fails closed — plan for both directions. For enforcement use the
  dedicated decision events (`preToolUse` deny, `permissionRequest` deny) and verify they
  actually block.
- **Hook commands run in the current session directory.** Since CLI 1.0.72 lifecycle and
  subagent hook commands follow `/cd`, so don't assume the directory the CLI started in.
  Resolve paths from the payload or an absolute base.
- **HTTPS is required** for `http` hooks (and mandatory for `preToolUse`/`permissionRequest`).
  Only expose env vars to headers via `allowedEnvVars`.
- **Never leak secrets** to stdout/stderr or to logs a hook writes; stdout is parsed/echoed.
- **Treat every payload as untrusted.** Parse stdin as JSON, validate expected fields, quote
  paths and arguments, avoid `eval` or dynamic shell construction, and allowlist privileged
  actions instead of interpolating tool names or user content into commands.
- **Minimize exposed authority.** Keep `allowedEnvVars`, filesystem access, and network
  destinations as narrow as possible; never pass an entire environment through for convenience.
- **Be idempotent and quiet on success**, especially for `sessionStart` install/setup hooks —
  they run every session. Exit `0` even on best-effort failure so you don't block startup.
- **Keep timeouts short** and avoid network calls on `sessionStart` unless necessary.
- **Cross-platform parity** — supply both `bash` and `powershell`, or `command`, so the hook
  runs for all users.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Hook not running | File in a valid location? Valid JSON (`jq . hooks.json`)? `version: 1` present? Script executable with a shebang? `disableAllHooks` not `true`? |
| Hook times out | Raise `timeoutSec` (default 30) or speed up the script. |
| Invalid JSON output | Output must be a single compact line — `jq -c` (Unix) or `ConvertTo-Json -Compress` (PowerShell). |
| Decision ignored | Right event for that decision? Exit code `0`? JSON field names exact (camelCase vs snake_case must match the event-name casing you used)? |
| Prompt hook never fires | Only fires for new interactive sessions — not resume, not `-p`. |

Debug a script by reading stdin, echoing it to stderr, and tracing with `set -x`.

## Verify

- [ ] `version: 1` and a `hooks` object keyed by valid event names
- [ ] Each entry has a valid `type` (`command`/`http`/`prompt`) with its required fields
- [ ] Command hooks provide `bash` and/or `powershell` (or `command`)
- [ ] HTTP hooks use `https://` (required for `preToolUse`/`permissionRequest`)
- [ ] `prompt` hooks only on `sessionStart`
- [ ] Decision-returning hooks emit single-line JSON and exit `0`
- [ ] `timeoutSec` is reasonable; scripts are executable with a shebang
- [ ] No secrets in stdout/stderr; fail-open behavior is acceptable for the use case
- [ ] Malformed or adversarial payloads fail safely without command injection or privilege expansion
- [ ] Catalog regenerated (marketplace plugins) and `validate.mjs` passes

## References

- [`references/hooks-reference.md`](references/hooks-reference.md) — event payloads, decision schemas, tool names
- [Using hooks with GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks)
- [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [About hooks for GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/hooks)
