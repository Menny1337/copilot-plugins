# Advisory memory-lint hook (sessionStart). Best-effort; never blocks the session.
# Delegates to lint-memory-advisory.mjs, which surfaces drift via additionalContext
# and always exits 0. Silent when node is unavailable or memory is clean.
#
# This script is dot-sourced by the hook runner (repo convention), so it saves and
# restores $ErrorActionPreference to avoid leaking state into the caller scope.

$__prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
try {
  # Run-once-per-session guard (see lint-memory-advisory.sh): de-dupe multiple
  # invocations in one session on the sessionStart stdin payload's sessionId via a
  # directory lock. On any failure, run normally. `return` (not exit) restores EAP
  # through the finally block under dot-sourcing.
  $__sid = ''
  if ([Console]::IsInputRedirected) {
    $__payload = [Console]::In.ReadToEnd()
    if ($__payload -match '"sessionId"\s*:\s*"([A-Za-z0-9._-]+)"') { $__sid = $Matches[1] }
  }
  if ($__sid) {
    $__lock = Join-Path ([System.IO.Path]::GetTempPath()) "lint-memory-advisory.$__sid"
    try { New-Item -ItemType Directory -Path $__lock -ErrorAction Stop | Out-Null }
    catch { return }
  }

  $hookDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $advisory = Join-Path $hookDir 'lint-memory-advisory.mjs'

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return }
  if (-not (Test-Path $advisory)) { return }

  & node $advisory 2>$null
}
finally {
  $ErrorActionPreference = $__prevEAP
}
