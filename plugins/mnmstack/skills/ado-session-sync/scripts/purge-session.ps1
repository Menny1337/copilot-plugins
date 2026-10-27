#!/usr/bin/env pwsh
# purge-session.ps1 — Windows mirror of purge-session.sh. Removes a headless
# ado-session-sync child session from the central Copilot session store
# (session-store.db) after its transcript has been archived elsewhere (moved
# session-state dir + ~/.copilot/logs/ado-session-sync/).
#
# Why: ~1/3 of the session store can be background sync children. Left in place they
# pollute the session picker, --continue, and full-text session search, and (once
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
#   purge-session.ps1 -Id <session-uuid> [-DbPath <path>] [-Quiet]
#   purge-session.ps1 -Sweep [-Yes] [-DbPath <path>] [-Marker <text>]   # backlog cleanup
#     (without -Yes, -Sweep only PREVIEWS how many sessions would be removed)

[CmdletBinding()]
param(
  [string]$Id = '',
  [string]$DbPath = '',
  [switch]$Sweep,
  [switch]$Yes,
  [string]$Marker = 'A Copilot session just yielded control back to the user',
  [switch]$Quiet
)

$ErrorActionPreference = 'SilentlyContinue'

function Say([string]$m) { if (-not $Quiet) { Write-Output $m } }

if (-not $DbPath -or $DbPath -eq '') {
  $home2 = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
  $DbPath = Join-Path $home2 'session-store.db'
}
if (-not (Test-Path $DbPath)) { Say "purge-session: no DB at $DbPath"; exit 0 }
if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) { Say 'purge-session: sqlite3 not found'; exit 0 }

# SQL-escape single quotes (defense-in-depth; a UUID never contains them and the
# marker is a fixed constant, but escape anyway).
function SqlQ([string]$s) { return ($s -replace "'", "''") }

# Which candidate tables actually exist in this store.
$existing = @(& sqlite3 $DbPath "SELECT name FROM sqlite_master WHERE type='table';" 2>$null)
function Has([string]$t) { return ($existing -contains $t) }

# Build the DELETE list. $sessPred keys the `sessions` table (by id); $depPred keys
# dependents (by session_id). Children are deleted before the parent `sessions` row.
function Build-Stmts([string]$sessPred, [string]$depPred) {
  $out = ''
  if (Has 'turns')         { $out += "DELETE FROM turns WHERE $depPred;`n" }
  if (Has 'checkpoints')   { $out += "DELETE FROM checkpoints WHERE $depPred;`n" }
  if (Has 'session_files') { $out += "DELETE FROM session_files WHERE $depPred;`n" }
  if (Has 'session_refs')  { $out += "DELETE FROM session_refs WHERE $depPred;`n" }
  if (Has 'search_index')  { $out += "DELETE FROM search_index WHERE $depPred;`n" }
  if (Has 'sessions')      { $out += "DELETE FROM sessions WHERE $sessPred;`n" }
  return $out
}

function Run-Txn([string]$stmts) {
  # Wrap in one immediate transaction; fail-open on any error. Discard stdout so
  # PRAGMA output never leaks to the caller.
  $sql = "PRAGMA busy_timeout=5000;`nBEGIN IMMEDIATE;`n$stmts`nCOMMIT;"
  $sql | & sqlite3 $DbPath *> $null
  return ($LASTEXITCODE -eq 0)
}

if ($Sweep) {
  $escM = SqlQ $Marker
  $predSess = "summary LIKE '$escM%'"
  $predDep  = "session_id IN (SELECT id FROM sessions WHERE summary LIKE '$escM%')"
  $nRaw = (& sqlite3 $DbPath "SELECT count(*) FROM sessions WHERE $predSess;" 2>$null | Select-Object -First 1)
  $n = 0; [void][int]::TryParse([string]$nRaw, [ref]$n)
  if (-not $Yes) {
    Say "purge-session -Sweep (dry run): $n ado-sync child session(s) match and WOULD be removed."
    Say 'Re-run with -Yes to delete them.'
    exit 0
  }
  if ($n -eq 0) { Say 'purge-session -Sweep: nothing to remove.'; exit 0 }
  $stmts = Build-Stmts $predSess $predDep
  if (Run-Txn $stmts) { Say "purge-session -Sweep: removed $n ado-sync child session(s)." }
  else { Say 'purge-session -Sweep: delete failed (fail-open, no partial change).' }
  exit 0
}

# Single-session mode: hard UUID guard — anything that is not a full session UUID is
# a no-op (never run a broad delete from a malformed id).
if ($Id -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
  Say 'purge-session: id is not a session UUID; no-op.'; exit 0
}

$escId = SqlQ $Id
$stmts = Build-Stmts "id='$escId'" "session_id='$escId'"
if (-not $stmts) { exit 0 }
if (Run-Txn $stmts) { Say "purge-session: removed session $Id from the store." }
else { Say "purge-session: delete failed for $Id (fail-open, no partial change)." }
exit 0
