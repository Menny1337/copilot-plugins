# github-session-sync.ps1 — agentStop hook launcher (session-yield → GitHub sync).
#
# PowerShell counterpart of github-session-sync.sh — see that file for the full
# gating rationale (mirrors ado-session-sync.ps1's structure). Logs to the SAME
# shared trail as ADO (~/.copilot/logs/ado-session-sync/) so sync-status.ps1/.sh
# and the sessionStart advisory hook work for both backends unmodified.

function Emit { Write-Output '{}'; exit 0 }

$selfDir = $PSScriptRoot
if (-not $selfDir) { $selfDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$pluginRoot = Split-Path -Parent $selfDir
$LOGGER = Join-Path $selfDir '..\skills\ado-session-sync\scripts\log-run.ps1'
function Log([hashtable]$a) { try { if (Test-Path $LOGGER) { & $LOGGER @a | Out-Null } } catch { } }
function DbgLog([hashtable]$a) { if ($env:COPILOT_PLUGIN_ADO_SYNC_LOGLEVEL -eq 'debug') { Log $a } }

# 1. Recursion guard.
if ($env:COPILOT_PLUGIN_TASK_SYNC_ACTIVE) { DbgLog @{ event = 'skip'; reason = 'recursion-guard' }; Emit }

# A force-disable must remain inert even when the selected config is invalid.
if ($env:COPILOT_PLUGIN_GITHUB_SESSION_SYNC -eq '0' -or $env:COPILOT_PLUGIN_TASK_SESSION_SYNC -eq '0') {
  DbgLog @{ event = 'skip'; reason = 'env-force-disabled' }; Emit
}

# Read the agentStop payload (camelCase) from stdin.
$payload = ''
try { if ([Console]::IsInputRedirected) { $payload = [Console]::In.ReadToEnd() } } catch { $payload = '' }
function Field([string]$name) {
  if ($payload -match ('"' + $name + '"\s*:\s*"([^"]*)"')) { return $Matches[1] }
  return ''
}
$SID = Field 'sessionId'
$TP  = Field 'transcriptPath'
$CWD = Field 'cwd'
if ($SID -notmatch '^[A-Za-z0-9._-]+$') { $SID = '' }
if (-not $CWD) { $CWD = (Get-Location).Path }

. (Join-Path $selfDir '..\shared\assistant-config.ps1')
try {
  $config = Get-MnmAssistantConfigPath
  $cfg = Read-MnmAssistantConfig $config
  if ((Get-MnmAssistantBackend $cfg) -ne 'github') { Emit }
} catch {
  Emit
}

# 2. Opt-in, with an explicit env override precedence (mirrors github-session-sync.sh).
$enabled = $false
if ($env:COPILOT_PLUGIN_GITHUB_SESSION_SYNC -eq '1' -or $env:COPILOT_PLUGIN_TASK_SESSION_SYNC -eq '1') {
  $enabled = $true
} elseif ($cfg.taskSessionSync.enabled -eq $true) {
  $enabled = $true
}
if (-not $enabled) { DbgLog @{ event = 'skip'; parent = $SID; reason = 'opt-in-disabled' }; Emit }

if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) {
  Log @{ event = 'skip'; parent = $SID; reason = 'no-copilot'; detail = 'copilot not on PATH' }; Emit
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Log @{ event = 'skip'; parent = $SID; reason = 'no-gh'; detail = 'gh CLI not on PATH' }; Emit
}
if (-not $SID) { Log @{ event = 'skip'; reason = 'no-session-id'; detail = 'no sessionId in payload' }; Emit }

# 3. Session scope: only top-level user sessions (UUID session ids).
if ($SID -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
  DbgLog @{ event = 'skip'; parent = $SID; reason = 'non-uuid-parent'; detail = 'sessionId is not a session UUID (sub-agent/sidekick stop); top-level session owns the sync' }
  Emit
}

# 4. Repo eligibility (allowlist) with an explicit issue-signal fast-path.
$syncRepos = @()
if ($cfg.taskSessionSync.syncRepos) { $syncRepos = @($cfg.taskSessionSync.syncRepos) }
if ($syncRepos.Count -gt 0) {
  function Expand-Tilde([string]$p) {
    if ($p -eq '~') { return $HOME }
    if ($p -like '~/*' -or $p -like '~\*') { return (Join-Path $HOME $p.Substring(2)) }
    return $p
  }
  $ccwd = (Expand-Tilde $CWD).TrimEnd('/', '\')
  $eligible = $false
  foreach ($pfx in $syncRepos) {
    $p = (Expand-Tilde ([string]$pfx)).TrimEnd('/', '\')
    if ($ccwd -eq $p -or $ccwd.StartsWith($p + '/') -or $ccwd.StartsWith($p + '\')) { $eligible = $true; break }
  }
  if (-not $eligible) {
    if ($TP -and (Test-Path $TP) -and (Select-String -Path $TP -Pattern '#[0-9]+|issues/[0-9]+' -Quiet)) {
      $eligible = $true
    } elseif (Get-Command git -ErrorAction SilentlyContinue) {
      $br = (git -C $CWD rev-parse --abbrev-ref HEAD 2>$null)
      if ($br -match '^[0-9]+[-/]' -or $br -match '/[0-9]') { $eligible = $true }
      elseif ((git -C $CWD log -3 --format='%B' 2>$null | Out-String) -match '#[0-9]+') { $eligible = $true }
    }
  }
  if (-not $eligible) {
    Log @{ event = 'skip'; parent = $SID; cwd = $CWD; reason = 'repo-not-eligible'; detail = 'cwd not under taskSessionSync.syncRepos and no explicit issue signal - skipped without spawning a sync child' }
    Emit
  }
}

# 5. Debounce (per eligible session). Ineligible/no-signal stops do not consume
# the window, so a later eligible stop from the same session can still launch.
$debounceMin = 10
if ($cfg.taskSessionSync.debounceMinutes -is [int]) { $debounceMin = [int]$cfg.taskSessionSync.debounceMinutes }
$stateDir = Join-Path ([System.IO.Path]::GetTempPath()) 'github-session-sync'
New-Item -ItemType Directory -Path $stateDir -ErrorAction SilentlyContinue | Out-Null
$stamp = Join-Path $stateDir "$SID.last"
$now = [int][double]::Parse((Get-Date -UFormat %s))
if (Test-Path $stamp) {
  try {
    $last = [int](Get-Content -Raw $stamp)
    if (($now - $last) -lt ($debounceMin * 60)) {
      $mins = [int](($now - $last) / 60)
      Log @{ event = 'skip'; parent = $SID; reason = 'debounced'; detail = "last sync ${mins}m ago (window ${debounceMin}m)" }
      Emit
    }
  } catch { }
}
try { Set-Content -Path $stamp -Value $now -NoNewline } catch { }

# Resolve the configured owner locally; identity probes remain inside the
# detached runner so agentStop never blocks on GitHub.
$githubOwner = ''
$githubOwnerType = 'user'
if ($cfg.github.owner -is [string]) { $githubOwner = [string]$cfg.github.owner }
if ($cfg.github.ownerType -eq 'org') { $githubOwnerType = 'org' }

# Correlate parent -> child with a stable child session id.
$CHILD = [guid]::NewGuid().ToString()

$logDir = Join-Path $HOME '.copilot/logs/ado-session-sync'
New-Item -ItemType Directory -Path $logDir -ErrorAction SilentlyContinue | Out-Null
$logFile = Join-Path $logDir "$SID.log"

Log @{ event = 'launch'; parent = $SID; child = $CHILD; cwd = $CWD; childlog = $logFile; maybePrune = $true }

$prompt = "A Copilot session just yielded control back to the user. parentSession=$SID syncSession=$CHILD transcriptPath=$TP cwd=$CWD. Invoke the github-session-sync skill and follow its procedure to update the related GitHub issue: post a concise progress comment carrying the hidden marker <!-- copilot-session:$SID --> (use the bundled session-map.mjs script for the exact marker text and the local session-to-issue cache; never hand-write the marker), then record the outcome via the skill's logger. If you cannot confidently identify a single related issue, skip without updating anything (and still record the skip). Use ONLY this closed vocabulary: event=result with action in {commented+tagged,tagged-only,skipped}; a skipped result also needs reason in {no-work,ambiguous,closed-item,duplicate}; a denied/failed write is event=error stage=update reason=write-blocked, NOT a skipped result. Keep the note to 2-5 sentences, terse, no secrets, and NEVER log a token."

$env:COPILOT_PLUGIN_TASK_SYNC_ACTIVE = '1'
$env:COPILOT_PLUGIN_SYNC_PROMPT = $prompt
$env:COPILOT_PLUGIN_SYNC_CHILD = $CHILD
$env:COPILOT_PLUGIN_SYNC_PARENT = $SID
$env:COPILOT_PLUGIN_SYNC_LOG = $logFile
$env:COPILOT_PLUGIN_SYNC_LOGGER = $LOGGER
$env:COPILOT_PLUGIN_SYNC_ADDDIR = (Join-Path $HOME '.copilot')
$env:COPILOT_PLUGIN_SYNC_PLUGIN_DIR = $pluginRoot
$env:COPILOT_PLUGIN_SYNC_NAME = "github-sync:$SID"
$env:COPILOT_PLUGIN_SYNC_GITHUB_OWNER = $githubOwner
$env:COPILOT_PLUGIN_SYNC_GITHUB_OWNER_TYPE = $githubOwnerType

$copilotHome = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
$stateDest = Join-Path $HOME '.copilot/ado-sync-sessions'
if ($cfg.taskSessionSync -and ($cfg.taskSessionSync.PSObject.Properties.Name -contains 'sessionStateDir')) {
  $sd = [string]$cfg.taskSessionSync.sessionStateDir
  if ($sd -eq '') { $stateDest = '' }
  elseif ($sd -eq '~') { $stateDest = $HOME }
  elseif ($sd -like '~/*' -or $sd -like '~\*') { $stateDest = (Join-Path $HOME $sd.Substring(2)) }
  else { $stateDest = $sd }
}
$env:COPILOT_PLUGIN_SYNC_STATE_SRC = (Join-Path $copilotHome ('session-state/' + $CHILD))
$env:COPILOT_PLUGIN_SYNC_STATE_DEST = $stateDest
$env:COPILOT_PLUGIN_SYNC_PURGE = (Join-Path $selfDir '..\skills\ado-session-sync\scripts\purge-session.ps1')

$inner = '$authOk=$true; if ($env:COPILOT_PLUGIN_SYNC_GITHUB_OWNER_TYPE -eq "user" -and $env:COPILOT_PLUGIN_SYNC_GITHUB_OWNER) { $ambient=(& gh api user --jq .login 2>$null); if ($ambient -ne $env:COPILOT_PLUGIN_SYNC_GITHUB_OWNER) { if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) { $savedGh=$env:GH_TOKEN; $savedGithub=$env:GITHUB_TOKEN; Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue; Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue; $keyring=(& gh api user --jq .login 2>$null); if ($keyring -ne $env:COPILOT_PLUGIN_SYNC_GITHUB_OWNER) { if ($null -ne $savedGh) { $env:GH_TOKEN=$savedGh }; if ($null -ne $savedGithub) { $env:GITHUB_TOKEN=$savedGithub }; $authOk=$false } } else { $authOk=$false } } }; $s=Get-Date; if ($authOk) { & copilot -p $env:COPILOT_PLUGIN_SYNC_PROMPT --name $env:COPILOT_PLUGIN_SYNC_NAME --session-id $env:COPILOT_PLUGIN_SYNC_CHILD --plugin-dir $env:COPILOT_PLUGIN_SYNC_PLUGIN_DIR --no-ask-user --allow-all --add-dir $env:COPILOT_PLUGIN_SYNC_ADDDIR --add-dir $env:COPILOT_PLUGIN_SYNC_PLUGIN_DIR -s --no-color --no-auto-update *> $env:COPILOT_PLUGIN_SYNC_LOG; $rc=$LASTEXITCODE } else { $rc=4; try { & $env:COPILOT_PLUGIN_SYNC_LOGGER -event error -parent $env:COPILOT_PLUGIN_SYNC_PARENT -child $env:COPILOT_PLUGIN_SYNC_CHILD -stage update -reason write-blocked -detail "GitHub CLI login does not match the configured user owner; sync child was not started" } catch {} }; $d=[int]((Get-Date)-$s).TotalSeconds; try { & $env:COPILOT_PLUGIN_SYNC_LOGGER -event child-exit -parent $env:COPILOT_PLUGIN_SYNC_PARENT -child $env:COPILOT_PLUGIN_SYNC_CHILD -exitc $rc -duration $d } catch {}; if ($env:COPILOT_PLUGIN_SYNC_STATE_DEST) { if (Test-Path $env:COPILOT_PLUGIN_SYNC_STATE_SRC) { try { New-Item -ItemType Directory -Path $env:COPILOT_PLUGIN_SYNC_STATE_DEST -ErrorAction SilentlyContinue | Out-Null; Move-Item -Path $env:COPILOT_PLUGIN_SYNC_STATE_SRC -Destination $env:COPILOT_PLUGIN_SYNC_STATE_DEST -Force } catch {} }; if ($env:COPILOT_PLUGIN_SYNC_PURGE -and (Test-Path $env:COPILOT_PLUGIN_SYNC_PURGE)) { try { & $env:COPILOT_PLUGIN_SYNC_PURGE -Id $env:COPILOT_PLUGIN_SYNC_CHILD -Quiet } catch {} } }'

# Detect the launcher shell BEFORE calling Start-Process, rather than relying
# on try/catch around Start-Process itself. Audited bug: Start-Process's
# failure to find `-FilePath` is not reliably a terminating error under every
# PowerShell/OS combination (observed non-terminating even with
# `-ErrorAction Stop` on pwsh/macOS) — a bare try/catch (or one adding only
# `-ErrorAction Stop`) can silently swallow the failure, leave the `catch`
# fallback unreached, and spawn nothing while still returning success. Command
# detection (the same `Get-Command ... -ErrorAction SilentlyContinue` idiom
# already used above for `copilot`/`gh`) is deterministic regardless of how
# Start-Process itself surfaces a missing executable.
$launcherShell = $null
if (Get-Command pwsh -ErrorAction SilentlyContinue) {
  $launcherShell = 'pwsh'
} elseif (Get-Command powershell -ErrorAction SilentlyContinue) {
  $launcherShell = 'powershell'
}
if ($launcherShell) {
  try {
    Start-Process -FilePath $launcherShell -ArgumentList '-NoProfile', '-Command', $inner `
      -WorkingDirectory $HOME -WindowStyle Hidden -ErrorAction Stop | Out-Null
  } catch {
    Log @{ event = 'error'; parent = $SID; stage = 'update'; reason = 'write-blocked'; detail = "Start-Process failed to launch $launcherShell for the headless sync child" }
  }
} else {
  Log @{ event = 'skip'; parent = $SID; reason = 'no-pwsh-or-powershell'; detail = 'neither pwsh nor powershell was found on PATH to launch the headless sync child' }
}

Emit
