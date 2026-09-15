# Reconcile pending captures with ADO

Use only at session start with the selected ADO backend. Read the
[capture configuration](../../assistant-capture/references/ado-configuration.md),
[ADO capture and fallback rules](../../assistant-capture/references/ado-tasks.md),
and [shared contract](../../assistant-capture/references/task-backend-contract.md).
Accept both `ado_status: pending` and backend-neutral `status: pending`.

### Pending Inbox Sync

When operating in ADO mode, on session start, scan `<config.fallbackInbox>` for entries with either pending status key. Resolve the configured path — default only when the key is absent, never silently ignore an explicit override:

```bash
CONFIG="${COPILOT_PLUGIN_ASSISTANT_CONFIG:-${COPILOT_PLUGIN_ADO_CONFIG:-$HOME/.copilot/assistant/config.json}}"
CONFIG="${CONFIG/#\~/$HOME}"
config=$(cat "$CONFIG") || exit 1
INBOX=$(echo "$config" | python3 -c "import sys,json; print(json.load(sys.stdin).get('fallbackInbox') or '~/.copilot/assistant/inbox.md')")
INBOX="${INBOX/#\~/$HOME}"   # expand a leading ~ (python's json.load never does this)
grep -E -B1 -A8 "^- (ado_status|status): pending$" "$INBOX"
```

For each pending entry, query ADO for any WI whose Description contains its `clientCaptureId`. This is a one-off existence probe (no `ado-query` lane); run it raw:

```bash
az boards query --wiql "
  SELECT [System.Id]
  FROM WorkItems
  WHERE [System.Description] CONTAINS '<clientCaptureId>'
" -o tsv
```

If no match → call `az boards work-item create` with the entry's data, including `<clientCaptureId>` in Description; mark inbox entry `ado_status: synced`.
If match → mark inbox entry `ado_status: synced` (was already created earlier).

For neutral entries, preserve the key as `status: synced`. Only mark synced after
confirming the remote item; failed creation remains pending and must be reported.
