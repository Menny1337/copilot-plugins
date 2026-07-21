#!/usr/bin/env bash
# purge-session.sh — remove a headless ado-session-sync child session from the
# central Copilot session store (session-store.db) after its transcript has been
# archived elsewhere (moved session-state dir + ~/.copilot/logs/ado-session-sync/).
#
# Why: ~1/3 of the session store can be background sync children. Left in place they
# pollute the session picker, `--continue`, and full-text session search, and (once
# their session-state dir is moved out) become dangling rows that break resume.
#
# What it deletes (single transaction, by exact session id): the `sessions` row plus
# its dependents `turns`, `checkpoints`, `session_files`, `session_refs`, and its FTS
# `search_index` entries. It NEVER touches the unrelated `cst_*` (VS Code chat import)
# or `forge_*` stores — a headless CLI child does not populate those.
#
# Safety: fail-open (never aborts the caller); only ever deletes by a full session
# UUID (single mode) or by the exact ado-sync summary marker (sweep mode); only
# touches tables that exist; uses BEGIN IMMEDIATE + busy_timeout so it waits for,
# rather than fights, a live CLI holding the DB.
#
# Usage:
#   purge-session.sh --id <session-uuid> [--db <path>] [--quiet]
#   purge-session.sh --sweep [--yes] [--db <path>] [--marker <text>]   # backlog cleanup
#     (without --yes, --sweep only PREVIEWS how many sessions would be removed)

set -u

# Exact opening of the launcher's headless prompt (see ado-session-sync.sh). Used
# only in --sweep mode to recognize past sync children by their session summary.
MARKER_DEFAULT="A Copilot session just yielded control back to the user"

ID=""; DB=""; SWEEP=0; YES=0; QUIET=0; MARKER="$MARKER_DEFAULT"
while [ $# -gt 0 ]; do
  case "$1" in
    --id)     ID="${2:-}"; shift 2 ;;
    --db)     DB="${2:-}"; shift 2 ;;
    --marker) MARKER="${2:-}"; shift 2 ;;
    --sweep)  SWEEP=1; shift ;;
    --yes)    YES=1; shift ;;
    --quiet)  QUIET=1; shift ;;
    *)        shift ;;
  esac
done

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }

[ -z "$DB" ] && DB="${COPILOT_HOME:-$HOME/.copilot}/session-store.db"
[ -f "$DB" ] || { say "purge-session: no DB at $DB"; exit 0; }
command -v sqlite3 >/dev/null 2>&1 || { say "purge-session: sqlite3 not found"; exit 0; }

# SQL-escape single quotes (defense-in-depth; a UUID never contains them, and the
# marker is a fixed constant, but escape anyway).
sqlq() { printf '%s' "$1" | sed "s/'/''/g"; }

# Which of the candidate tables actually exist in this store.
existing="$(sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table';" 2>/dev/null)"
has() { printf '%s\n' "$existing" | grep -qx "$1"; }

# Build the DELETE list for a given WHERE predicate on the child key. $1 is the
# predicate for the `sessions` table (keyed by id); $2 for dependents (keyed by
# session_id). Children are deleted before the parent `sessions` row.
build_stmts() {
  _sess_pred="$1"; _dep_pred="$2"; _out=""
  has turns         && _out="${_out}DELETE FROM turns WHERE ${_dep_pred};
"
  has checkpoints   && _out="${_out}DELETE FROM checkpoints WHERE ${_dep_pred};
"
  has session_files && _out="${_out}DELETE FROM session_files WHERE ${_dep_pred};
"
  has session_refs  && _out="${_out}DELETE FROM session_refs WHERE ${_dep_pred};
"
  has search_index  && _out="${_out}DELETE FROM search_index WHERE ${_dep_pred};
"
  has sessions      && _out="${_out}DELETE FROM sessions WHERE ${_sess_pred};
"
  printf '%s' "$_out"
}

run_txn() {
  # $1 = statements. Wrap in one immediate transaction; fail-open on any error.
  # Discard stdout so PRAGMA/echo output never leaks to the caller.
  sqlite3 "$DB" >/dev/null 2>&1 <<SQL || return 1
PRAGMA busy_timeout=5000;
BEGIN IMMEDIATE;
$1
COMMIT;
SQL
  return 0
}

if [ "$SWEEP" = 1 ]; then
  esc_marker="$(sqlq "$MARKER")"
  pred_sess="summary LIKE '${esc_marker}%'"
  pred_dep="session_id IN (SELECT id FROM sessions WHERE summary LIKE '${esc_marker}%')"
  n="$(sqlite3 "$DB" "SELECT count(*) FROM sessions WHERE ${pred_sess};" 2>/dev/null || echo 0)"
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  if [ "$YES" != 1 ]; then
    say "purge-session --sweep (dry run): $n ado-sync child session(s) match and WOULD be removed."
    say "Re-run with --yes to delete them."
    exit 0
  fi
  [ "$n" -eq 0 ] && { say "purge-session --sweep: nothing to remove."; exit 0; }
  stmts="$(build_stmts "$pred_sess" "$pred_dep")"
  if run_txn "$stmts"; then
    say "purge-session --sweep: removed $n ado-sync child session(s)."
  else
    say "purge-session --sweep: delete failed (fail-open, no partial change)."
  fi
  exit 0
fi

# Single-session mode: hard UUID guard — anything that is not a full session UUID
# is a no-op (never run a broad delete from a malformed id).
case "$ID" in
  [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;;
  *) say "purge-session: id is not a session UUID; no-op."; exit 0 ;;
esac

esc_id="$(sqlq "$ID")"
stmts="$(build_stmts "id='${esc_id}'" "session_id='${esc_id}'")"
[ -z "$stmts" ] && exit 0
if run_txn "$stmts"; then
  say "purge-session: removed session $ID from the store."
else
  say "purge-session: delete failed for $ID (fail-open, no partial change)."
fi
exit 0
