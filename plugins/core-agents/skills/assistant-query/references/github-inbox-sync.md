# Reconcile pending captures with GitHub

Use only at session start with the selected GitHub backend. Read the
[GitHub configuration and authentication](../../assistant-capture/references/github-configuration.md)
and [GitHub capture rules](../../assistant-capture/references/github-tasks.md)
before any remote write.

### Pending Inbox Sync

When operating in GitHub mode, on session start, scan `<config.fallbackInbox>` for
entries with `status: pending` (and legacy `ado_status: pending` entries left over from
before a cutover — see [task-backend contract: Configuration
versioning](../../assistant-capture/references/task-backend-contract.md#configuration-versioning)). Resolve the configured path the same way as [ADO mode](ado-inbox-sync.md) — default
only when `fallbackInbox` is absent from config, never hardcode past an explicit
override:

```bash
CONFIG="${COPILOT_PLUGIN_ASSISTANT_CONFIG:-${COPILOT_PLUGIN_ADO_CONFIG:-$HOME/.copilot/assistant/config.json}}"
CONFIG="${CONFIG/#\~/$HOME}"
config=$(cat "$CONFIG") || exit 1
INBOX=$(echo "$config" | python3 -c "import sys,json; print(json.load(sys.stdin).get('fallbackInbox') or '~/.copilot/assistant/inbox.md')")
INBOX="${INBOX/#\~/$HOME}"
grep -E -B1 -A8 "^- (ado_status|status): pending$" "$INBOX"
```

For each pending entry, search for an issue whose body contains its `clientCaptureId`
([capture §3.6.9](../../assistant-capture/references/github-tasks.md#369-capture-time-fallback-inboxmd)). If no match → create the issue with the entry's data, embedding
`clientCaptureId` in the body; mark the inbox entry `status: synced`. If match → mark
`status: synced` (already created earlier).

The scan includes both keys. Preserve the original status key when marking an
entry synced, and do so only after confirming the remote item. Failed creation
stays pending and must be reported, with the original input and marker preserved.
