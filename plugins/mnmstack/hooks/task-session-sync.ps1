# task-session-sync.ps1 — agentStop hook dispatcher (session-yield → task backend sync).
#
# PowerShell counterpart of task-session-sync.sh. Backend-neutral: reads only
# `taskBackend` from config, then dot-sources the concrete per-backend launcher
# (ado-session-sync.ps1 or github-session-sync.ps1) so stdin (Console.In) is still
# unread when the delegate script performs its own read — exactly like the exec
# hand-off in the bash dispatcher.
#
# Recursion guard is checked first (before any file/stdin access), honoring both
# the legacy ADO-specific flag and the neutral one.

$__prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
try {
  function Emit { Write-Output '{}'; exit 0 }

  if ($env:COPILOT_PLUGIN_TASK_SYNC_ACTIVE -or $env:ADO_SYNC_ACTIVE) { Emit }

  $selfDir = $PSScriptRoot
  if (-not $selfDir) { $selfDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
  . (Join-Path $selfDir '..\shared\assistant-config.ps1')
  try {
    $config = Get-MnmAssistantConfigPath
    $cfg = Read-MnmAssistantConfig $config
    $backend = Get-MnmAssistantBackend $cfg
  } catch {
    Emit
  }

  $target = if ($backend -eq 'github') {
    Join-Path $selfDir 'github-session-sync.ps1'
  } elseif ($backend -eq 'ado') {
    Join-Path $selfDir 'ado-session-sync.ps1'
  } else {
    Emit
  }

  if (Test-Path $target) {
    . $target
  } else {
    Emit
  }
}
finally {
  $ErrorActionPreference = $__prevEAP
}
