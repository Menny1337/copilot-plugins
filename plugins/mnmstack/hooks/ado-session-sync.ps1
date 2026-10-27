# ado-session-sync.ps1 — agentStop hook launcher (session-yield → ADO sync).
#
# Windows counterpart of ado-session-sync.sh. Best-effort, fail-open, and
# NON-BLOCKING: gates here, logs each decision via scripts/log-run.ps1, then
# spawns a detached headless `copilot -p` agent that runs the ado-session-sync
# skill. Always prints `{}` and exits 0; never returns decision:"block".
#
# The headless child is tagged with --name "ado-sync:<parentSession>" and, after
# it exits, its transient session-state dir is moved to adoSessionSync.sessionStateDir
# (default ~/.copilot/ado-sync-sessions; empty string disables), and its now-dangling
# row is deregistered from session-store.db via scripts/purge-session.ps1 — relocation
# and store cleanup stay coupled (both gated on the same sessionStateDir setting).
#
# Opt-in precedence (mirrors ado-session-sync.sh):
#   ADO_SESSION_SYNC=0 -> force-disabled, regardless of config (always wins).
#   ADO_SESSION_SYNC=1 -> bypasses opt-in only for a valid selected ADO target.
#   otherwise              -> existing config rule: adoSessionSync.enabled == true
#                             AND taskBackend == "ado" in the selected config.
# COPILOT_PLUGIN_TASK_SESSION_SYNC has the same effect for either backend.

function Emit { Write-Output '{}'; exit 0 }

$selfDir = $PSScriptRoot
if (-not $selfDir) { $selfDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$pluginRoot = Split-Path -Parent $selfDir
$LOGGER = Join-Path $selfDir '..\skills\ado-session-sync\scripts\log-run.ps1'
function Log([hashtable]$a) { try { if (Test-Path $LOGGER) { & $LOGGER @a | Out-Null } } catch { } }
function DbgLog([hashtable]$a) { if ($env:COPILOT_PLUGIN_ADO_SYNC_LOGLEVEL -eq 'debug') { Log $a } }

# 1. Recursion guard.
if ($env:ADO_SYNC_ACTIVE) { DbgLog @{ event = 'skip'; reason = 'recursion-guard' }; Emit }

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

# 2. Opt-in, with an explicit env override precedence:
#    ADO_SESSION_SYNC=0 force-disables the hook regardless of config (checked
#    FIRST, so it always wins even when config would enable sync).
#    ADO_SESSION_SYNC=1 bypasses opt-in only for a valid selected ADO target.
#    Otherwise the existing config rule applies: adoSessionSync.enabled == true
#    AND taskBackend == "ado".
if ($env:ADO_SESSION_SYNC -eq '0' -or $env:COPILOT_PLUGIN_TASK_SESSION_SYNC -eq '0') {
  DbgLog @{ event = 'skip'; parent = $SID; reason = 'env-force-disabled' }; Emit
}
try {
  . (Join-Path $selfDir '../shared/assistant-config.ps1')
  $config = Get-MnmAssistantConfigPath
  $backend = Get-MnmAssistantBackend (Read-MnmAssistantConfig $config)
} catch { [Console]::Error.WriteLine($_.Exception.Message); Emit }
if ($backend -ne 'ado') { Emit }
$env:COPILOT_PLUGIN_ASSISTANT_CONFIG = $config
$env:COPILOT_PLUGIN_SYNC_CONFIG = $config
$enabled = $false
if ($env:ADO_SESSION_SYNC -eq '1' -or $env:COPILOT_PLUGIN_TASK_SESSION_SYNC -eq '1') {
  $enabled = $true
} elseif (Test-Path $config) {
  try {
    $cfg = Get-Content -Raw $config | ConvertFrom-Json
    if ($cfg.adoSessionSync.enabled -is [bool] -and $cfg.adoSessionSync.enabled -eq $true -and $cfg.taskBackend -eq 'ado') { $enabled = $true }
  } catch { $enabled = $false }
}
if (-not $enabled) { DbgLog @{ event = 'skip'; parent = $SID; reason = 'opt-in-disabled' }; Emit }

if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) {
  Log @{ event = 'skip'; parent = $SID; reason = 'no-copilot'; detail = 'copilot not on PATH' }; Emit
}
if (-not $SID) { Log @{ event = 'skip'; reason = 'no-session-id'; detail = 'no sessionId in payload' }; Emit }

# 3. Session scope: only top-level user sessions (UUID session ids) drive a sync.
#    Sub-agent (tool-call id, e.g. toolu_*) and sidekick (sidekick-*) stops also fire
#    agentStop but are not real sessions; the skill cannot mint a valid session:<uuid>
#    tag from a non-UUID, and the owning top-level session already covers the work.
#    Skip them cheaply here (debug level) instead of spawning a doomed headless child.
if ($SID -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
  DbgLog @{ event = 'skip'; parent = $SID; reason = 'non-uuid-parent'; detail = 'sessionId is not a session UUID (sub-agent/sidekick stop); top-level session owns the sync' }
  Emit
}

# 4. Debounce (per session). Default 10 minutes; override via config.
$debounceMin = 10
if (Test-Path $config) {
  try {
    $cfg = Get-Content -Raw $config | ConvertFrom-Json
    if ($cfg.adoSessionSync.debounceMinutes -is [int]) { $debounceMin = [int]$cfg.adoSessionSync.debounceMinutes }
  } catch { }
}
$stateDir = Join-Path ([System.IO.Path]::GetTempPath()) 'ado-session-sync'
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

# 4b. Repo eligibility (allowlist) with an explicit work-item fast-path.
#    Mirrors ado-session-sync.sh: when adoSessionSync.syncRepos is set and non-empty,
#    a session whose cwd is not under any listed prefix is skipped cheaply here (no
#    ~4-minute headless child) unless it carries an explicit work-item signal (an
#    AB#/"work item N"/_workitems URL in the transcript, or a numeric branch / AB#
#    commit trailer in cwd). The fast-path only ADDs spawns, never suppresses one;
#    unset/empty syncRepos keeps the original behavior (every session is eligible).
#    Runs AFTER debounce so a burst of yields in a non-eligible repo logs one
#    repo-not-eligible (an honest "saved a child" count), not one per yield.
$syncRepos = @()
if (Test-Path $config) {
  try {
    $cfg = Get-Content -Raw $config | ConvertFrom-Json
    if ($cfg.adoSessionSync.syncRepos) { $syncRepos = @($cfg.adoSessionSync.syncRepos) }
  } catch { }
}
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
    if ($TP -and (Test-Path $TP) -and (Select-String -Path $TP -Pattern 'AB#[0-9]+|work item[s]? [0-9]+|_workitems/edit/[0-9]+' -Quiet)) {
      $eligible = $true
    } elseif (Get-Command git -ErrorAction SilentlyContinue) {
      $br = (git -C $CWD rev-parse --abbrev-ref HEAD 2>$null)
      if ($br -match '^[0-9]+[-/]' -or $br -match '/[0-9]') { $eligible = $true }
      elseif ((git -C $CWD log -3 --format='%B' 2>$null | Out-String) -match 'AB#[0-9]+') { $eligible = $true }
    }
  }
  if (-not $eligible) {
    Log @{ event = 'skip'; parent = $SID; cwd = $CWD; reason = 'repo-not-eligible'; detail = 'cwd not under adoSessionSync.syncRepos and no explicit work-item signal - skipped without spawning a sync child' }
    Emit
  }
}

# Correlate parent → child with a stable child session id.
$CHILD = [guid]::NewGuid().ToString()

# 4. Launch the headless sync, detached and non-blocking.
$logDir = Join-Path $HOME '.copilot/logs/ado-session-sync'
New-Item -ItemType Directory -Path $logDir -ErrorAction SilentlyContinue | Out-Null
$logFile = Join-Path $logDir "$SID.log"

Log @{ event = 'launch'; parent = $SID; child = $CHILD; cwd = $CWD; childlog = $logFile; maybePrune = $true }

$prompt = "A Copilot session just yielded control back to the user. parentSession=$SID syncSession=$CHILD transcriptPath=$TP cwd=$CWD. Invoke the ado-session-sync skill and follow its procedure to update the related Azure DevOps work item: post a concise progress comment and add a session:<id> tag for rediscovery, then record the outcome via the skill's logger. If you cannot confidently identify a single related work item, skip without updating anything (and still record the skip). FALLBACK (only if the ado-session-sync skill is NOT loadable in this runtime): perform the same procedure from context and record exactly ONE terminal event via the logger at the path in env COPILOT_PLUGIN_SYNC_LOGGER, or if that is unavailable by appending one JSON line to ~/.copilot/logs/ado-session-sync/runs.jsonl using logger-compatible field names ts,parent,child (not timestamp,parentSession,syncSession). Use ONLY this closed vocabulary: event=result with action in {commented+tagged,tagged-only,state-nudged,skipped}; a skipped result also needs reason in {no-work,ambiguous,closed-item,duplicate}; if you TRIED to write to ADO but it was denied or failed (e.g. 'Permission denied and could not request permission from user'), log event=error stage=update reason=write-blocked, NOT a skipped result. Keep the note to 2-5 sentences, terse, no secrets."

# Pass everything via env (inherited by the detached child) so nothing dynamic
# is interpolated into the command string. The child runs copilot, then logs
# child-exit with the real exit code and duration.
$env:ADO_SYNC_ACTIVE = '1'
$env:COPILOT_PLUGIN_SYNC_PROMPT = "$prompt Read only the assistant config selected by env COPILOT_PLUGIN_ASSISTANT_CONFIG (also pinned in COPILOT_PLUGIN_SYNC_CONFIG). Validate its backend and target again before any write; do not fall back to the default file or teamBoard."
$env:COPILOT_PLUGIN_SYNC_CHILD = $CHILD
$env:COPILOT_PLUGIN_SYNC_PARENT = $SID
$env:COPILOT_PLUGIN_SYNC_LOG = $logFile
$env:COPILOT_PLUGIN_SYNC_LOGGER = $LOGGER
$env:COPILOT_PLUGIN_SYNC_ADDDIR = (Join-Path $HOME '.copilot')
$env:COPILOT_PLUGIN_SYNC_PLUGIN_DIR = $pluginRoot
# Tag the headless child session so it is identifiable/filterable in the session
# list and resumable by name (copilot --resume="ado-sync:<parentSession>").
$env:COPILOT_PLUGIN_SYNC_NAME = "ado-sync:$SID"

# Session-state relocation (mirrors ado-session-sync.sh): after the child exits,
# move its transient on-disk session-state dir out of the normal store (the
# session-store.db row stays; only the state files move). Target from
# adoSessionSync.sessionStateDir: unset => default ~/.copilot/ado-sync-sessions;
# empty string => disabled (leave in place). Honors COPILOT_HOME for the source base.
$copilotHome = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
$stateDest = Join-Path $HOME '.copilot/ado-sync-sessions'
if (Test-Path $config) {
  try {
    $cfg = Get-Content -Raw $config | ConvertFrom-Json
    if ($cfg.adoSessionSync -and ($cfg.adoSessionSync.PSObject.Properties.Name -contains 'sessionStateDir')) {
      $sd = [string]$cfg.adoSessionSync.sessionStateDir
      if ($sd -eq '') { $stateDest = '' }
      elseif ($sd -eq '~') { $stateDest = $HOME }
      elseif ($sd -like '~/*' -or $sd -like '~\*') { $stateDest = (Join-Path $HOME $sd.Substring(2)) }
      else { $stateDest = $sd }
    }
  } catch { }
}
$env:COPILOT_PLUGIN_SYNC_STATE_SRC = (Join-Path $copilotHome ('session-state/' + $CHILD))
$env:COPILOT_PLUGIN_SYNC_STATE_DEST = $stateDest
# Deregister the child from the central session store after its state dir is
# relocated, so the moved dir does not leave a dangling row that breaks
# --continue/--resume and pollutes session search. Coupled to relocation: only runs
# when COPILOT_PLUGIN_SYNC_STATE_DEST is set.
$env:COPILOT_PLUGIN_SYNC_PURGE = (Join-Path $selfDir '..\skills\ado-session-sync\scripts\purge-session.ps1')

# ADO auth context (decoupled from the active `az` subscription): dot-source the auth
# helper so $env:AZURE_DEVOPS_EXT_PAT is set and inherited by the headless child. By
# default the helper mints a short-lived Entra (AAD) token for the org's tenant from your
# existing `az login` (a stored PAT is an optional override); the child then authenticates
# az boards/az devops by token regardless of which az account/tenant is active, without
# touching the user's az config. Fail-open: nothing resolvable => ambient az auth (prior behavior).
$authHelper = Join-Path $selfDir '..\skills\ado-session-sync\scripts\ado-auth.ps1'
try { if (Test-Path $authHelper) { . $authHelper | Out-Null } } catch { }

# Permissions: the child runs fully autonomously, so use --allow-all (tools +
# paths + URLs). Mutating az boards writes can still hit a no-user permission
# request with narrower grants. The child also receives this plugin via
# --plugin-dir, plus explicit --add-dir entries for ~/.copilot and the plugin.
#
# Trusted cwd: the child runs from $HOME, NOT the parent's work repo ($CWD). A
# mutating `az` is denied when the process cwd is a content-excluded repo
# ("Permission denied and could not request permission from user") because the
# headless child cannot satisfy an interactive permission prompt. The skill reads
# the work-repo path from the prompt (cwd=...) and inspects it with `git -C "<cwd>"`,
# so it does not need the process cwd to BE the repo.
$inner = '$s=Get-Date; & copilot -p $env:COPILOT_PLUGIN_SYNC_PROMPT --name $env:COPILOT_PLUGIN_SYNC_NAME --session-id $env:COPILOT_PLUGIN_SYNC_CHILD --plugin-dir $env:COPILOT_PLUGIN_SYNC_PLUGIN_DIR --no-ask-user --allow-all --add-dir $env:COPILOT_PLUGIN_SYNC_ADDDIR --add-dir $env:COPILOT_PLUGIN_SYNC_PLUGIN_DIR -s --no-color --no-auto-update *> $env:COPILOT_PLUGIN_SYNC_LOG; $rc=$LASTEXITCODE; $d=[int]((Get-Date)-$s).TotalSeconds; try { & $env:COPILOT_PLUGIN_SYNC_LOGGER -event child-exit -parent $env:COPILOT_PLUGIN_SYNC_PARENT -child $env:COPILOT_PLUGIN_SYNC_CHILD -exitc $rc -duration $d } catch {}; if ($env:COPILOT_PLUGIN_SYNC_STATE_DEST) { if (Test-Path $env:COPILOT_PLUGIN_SYNC_STATE_SRC) { try { New-Item -ItemType Directory -Path $env:COPILOT_PLUGIN_SYNC_STATE_DEST -ErrorAction SilentlyContinue | Out-Null; Move-Item -Path $env:COPILOT_PLUGIN_SYNC_STATE_SRC -Destination $env:COPILOT_PLUGIN_SYNC_STATE_DEST -Force } catch {} }; if ($env:COPILOT_PLUGIN_SYNC_PURGE -and (Test-Path $env:COPILOT_PLUGIN_SYNC_PURGE)) { try { & $env:COPILOT_PLUGIN_SYNC_PURGE -Id $env:COPILOT_PLUGIN_SYNC_CHILD -Quiet } catch {} } }'

try {
  Start-Process -FilePath 'pwsh' -ArgumentList '-NoProfile', '-Command', $inner `
    -WorkingDirectory $HOME -WindowStyle Hidden | Out-Null
} catch {
  try {
    Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile', '-Command', $inner `
      -WorkingDirectory $HOME -WindowStyle Hidden | Out-Null
  } catch { }
}

Emit
