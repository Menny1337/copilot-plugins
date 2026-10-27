# detect-tools.ps1 — environment tool-awareness hook (sessionStart). Best-effort.
#
# PowerShell parity for detect-tools.sh: probes a curated list of dev-relevant CLI
# tools (hooks/default-tools.txt plus optional ~/.copilot/env-tools.txt) and
# injects one concise { "additionalContext": "..." } line into the session. Names
# only, no versions; the agent runs `<tool> --help` on demand. We do NOT create a
# skill per tool — that would clog context.
#
# This script is dot-sourced by the hook runner (repo convention), so it saves and
# restores $ErrorActionPreference and uses `return` (not exit) to stay best-effort
# and never block startup.

$__prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
try {
  # Run-once-per-session guard (see detect-tools.sh): de-dupe multiple invocations in
  # one session on the sessionStart stdin payload's sessionId via a directory lock.
  # On any failure or missing sessionId, run normally.
  $__sid = ''
  if ([Console]::IsInputRedirected) {
    $__payload = [Console]::In.ReadToEnd()
    if ($__payload -match '"sessionId"\s*:\s*"([A-Za-z0-9._-]+)"') { $__sid = $Matches[1] }
  }
  if ($__sid) {
    $__lock = Join-Path ([System.IO.Path]::GetTempPath()) "detect-tools.$__sid"
    try { New-Item -ItemType Directory -Path $__lock -ErrorAction Stop | Out-Null }
    catch { return }
  }

  $hookDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $defaults = Join-Path $hookDir 'default-tools.txt'
  $override = Join-Path $HOME '.copilot/env-tools.txt'

  if (-not (Test-Path $defaults)) { return }

  # Collect candidates: defaults (unlimited) then a strictly-sanitized override (cap 50).
  # Treat each line as data only; allow a conservative charset; skip blanks/comments.
  $safe = '^[A-Za-z0-9._+-]+$'
  function Read-Candidates([string]$file, [int]$cap) {
    if (-not (Test-Path $file)) { return @() }
    $out = New-Object System.Collections.Generic.List[string]
    $n = 0
    foreach ($raw in (Get-Content -LiteralPath $file -ErrorAction SilentlyContinue)) {
      $line = ($raw -replace '#.*$', '').Trim()
      if ($line -eq '') { continue }
      if ($line -notmatch $safe) { continue }
      if ($line.Length -gt 64) { continue }
      $out.Add($line)
      $n++
      if ($cap -gt 0 -and $n -ge $cap) { break }
    }
    return $out
  }

  $candidates = @()
  $candidates += Read-Candidates $defaults 0
  $candidates += Read-Candidates $override 50
  $candidates = $candidates | Sort-Object -Unique
  if (-not $candidates) { return }

  # Probe: keep only real executables (not aliases/functions/cmdlets).
  $found = New-Object System.Collections.Generic.List[string]
  foreach ($t in $candidates) {
    $cmd = Get-Command -Name $t -CommandType Application, ExternalScript -ErrorAction SilentlyContinue
    if ($cmd) { $found.Add($t) }
  }
  $found = $found | Sort-Object -Unique
  if (-not $found) { return }

  $list = [string]::Join(', ', $found)
  $msg = "[Environment - sessionStart hook] Detected executable names on PATH (curated probe): $list. " +
         "This list is curated, not exhaustive - tools not listed may still be available, and presence on PATH does not guarantee a tool is configured/authenticated. " +
         "Verify with ``<tool> --help`` before nontrivial use."

  # ConvertTo-Json handles any escaping; -Compress keeps it single-line.
  [pscustomobject]@{ additionalContext = $msg } | ConvertTo-Json -Compress
}
finally {
  $ErrorActionPreference = $__prevEAP
}
