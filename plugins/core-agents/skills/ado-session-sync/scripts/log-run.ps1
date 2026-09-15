# log-run.ps1 — structured logger for ado-session-sync observability (Windows parity).
#
# Mirrors log-run.sh: appends one JSON line to
# ~/.copilot/logs/ado-session-sync/runs.jsonl and a human line to runs.log.
# Verbosity via the selected backend's sync block (or env COPILOT_PLUGIN_ADO_SYNC_LOGLEVEL) =
# off | result | debug (default result). Fail-open: always exits 0.
#
# Usage: log-run.ps1 -event <launch|skip|child-exit|result|error> [ -parent .. ]
[CmdletBinding()]
param(
  [string]$event,
  [string]$parent,
  [string]$child,
  [string]$cwd,
  [string]$childlog,
  [string]$reason,
  [string]$item,
  [string]$action,
  [string]$note,
  [string]$detail,
  [string]$stage,
  [string]$exitc,
  [string]$duration,
  [switch]$maybePrune
)

try {
  if (-not $event) { exit 0 }

  $logDir = Join-Path $HOME '.copilot/logs/ado-session-sync'
  try {
    . (Join-Path $PSScriptRoot '../../../shared/assistant-config.ps1')
    $config = Get-MnmAssistantConfigPath
    $cfg = Read-MnmAssistantConfig $config
    $backend = Get-MnmAssistantBackend $cfg
  } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 0 }
  $syncBlock = if ($backend -eq 'github') { 'taskSessionSync' } else { 'adoSessionSync' }

  # Verbosity.
  $level = $env:COPILOT_PLUGIN_ADO_SYNC_LOGLEVEL
  $retdays = 30
  if (-not $level -and $cfg.$syncBlock.logLevel) { $level = [string]$cfg.$syncBlock.logLevel }
  $retention = $cfg.$syncBlock.retentionDays
  if (($retention -is [int] -or $retention -is [long]) -and $retention -ge 0 -and $retention -le [int]::MaxValue) {
    $retdays = [int]$retention
  }
  if ($level -notin @('off','result','debug')) { $level = 'result' }
  if ($level -eq 'off') { exit 0 }

  $evLevel = 'result'
  if ($event -eq 'skip' -and ($reason -eq 'opt-in-disabled' -or $reason -eq 'recursion-guard')) { $evLevel = 'debug' }
  if ($level -eq 'result' -and $evLevel -eq 'debug') { exit 0 }

  New-Item -ItemType Directory -Path $logDir -ErrorAction SilentlyContinue | Out-Null
  $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

  function IsInt([string]$v) { return $v -and ($v -match '^-?\d+$') }

  $o = [ordered]@{ ts = $ts; event = $event }
  foreach ($p in @(@('parent',$parent),@('child',$child),@('cwd',$cwd),@('childLog',$childlog),
                   @('reason',$reason),@('action',$action),@('note',$note),@('detail',$detail),@('stage',$stage))) {
    if ($p[1]) { $o[$p[0]] = $p[1] }
  }
  if (IsInt $item)     { $o['item'] = [int]$item }
  if (IsInt $exitc)    { $o['exit'] = [int]$exitc }
  if (IsInt $duration) { $o['durationSec'] = [int]$duration }

  $json = ($o | ConvertTo-Json -Compress)
  Add-Content -Path (Join-Path $logDir 'runs.jsonl') -Value $json -ErrorAction SilentlyContinue

  $h = "$ts  $event"
  if ($parent)   { $h += "  parent=$parent" }
  if ($child)    { $h += "  child=$child" }
  if ($item)     { $h += "  item=$item" }
  if ($action)   { $h += "  action=$action" }
  if ($reason)   { $h += "  reason=$reason" }
  if ($stage)    { $h += "  stage=$stage" }
  if ($exitc)    { $h += "  exit=$exitc" }
  if ($duration) { $h += "  ${duration}s" }
  $short = if ($note) { $note } else { $detail }
  if ($short) { $h += "  - " + (($short -replace "`r?`n",' ')).Substring(0, [Math]::Min(160, $short.Length)) }
  Add-Content -Path (Join-Path $logDir 'runs.log') -Value $h -ErrorAction SilentlyContinue

  if ($maybePrune -and $retdays -gt 0) {
    $marker = Join-Path $logDir '.last-prune'
    $now = [int][double]::Parse((Get-Date -UFormat %s))
    $lastp = 0
    if (Test-Path $marker) { try { $lastp = [int](Get-Content -Raw $marker) } catch { $lastp = 0 } }
    if (($now - $lastp) -ge 86400) {
      Set-Content -Path $marker -Value $now -NoNewline -ErrorAction SilentlyContinue
      $cutoffDate = (Get-Date).ToUniversalTime().AddDays(-$retdays)
      Get-ChildItem -Path $logDir -Filter '*.log' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne 'runs.log' -and $_.LastWriteTimeUtc -lt $cutoffDate } |
        Remove-Item -ErrorAction SilentlyContinue
      $runs = Join-Path $logDir 'runs.jsonl'
      if (Test-Path $runs) {
        $cutoff = $cutoffDate.ToString('yyyy-MM-ddTHH:mm:ssZ')
        try {
          $kept = Get-Content $runs | Where-Object {
            try {
              $e = $_ | ConvertFrom-Json
              $ts = if ($e.ts) { $e.ts } else { $e.timestamp }
              $ts -ge $cutoff
            } catch { $true }
          }
          Set-Content -Path $runs -Value $kept -ErrorAction SilentlyContinue
        } catch { }
      }
    }
  }
} catch { }
exit 0
