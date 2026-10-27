# ado-auth.ps1 — establish a headless ADO auth context for ado-session-sync.
#
# PowerShell parity for ado-auth.sh (AAD-token-first). WHY: the session-yield sync runs
# `az boards` / `az devops` HEADLESSLY; relying on the ambient `az login` identity breaks
# when the active subscription is the wrong tenant for the ADO org (TF400813 / HTTP 401).
#
# HOW (frictionless, zero-config): mint a short-lived Entra (AAD) access token for the
# org's tenant from your EXISTING `az login`, and hand it to az devops/az boards via
# $env:AZURE_DEVOPS_EXT_PAT (the CLI accepts an AAD bearer token there, not only a PAT).
# The org's tenant is auto-detected; a logged-in subscription in that tenant is pinned so
# `az account get-access-token` uses the right account+tenant even when a personal/MSA
# subscription is your active default — WITHOUT switching it. No PAT, no browser, no admin.
#
# DUAL MODE:
#   • DOT-SOURCED ( . ado-auth.ps1 )  -> sets $env:AZURE_DEVOPS_EXT_PAT when a token
#                                        resolves; prints nothing. Fail-open.
#   • INVOKED ( ado-auth.ps1 <cmd> )  -> CLI: status | tenant | set | path | help
#
# Auth resolution order (first hit wins):
#   1. $env:AZURE_DEVOPS_EXT_PAT already set (respected as-is)
#   2. a stored PAT (ado.patFile / ado.patEnv / ~/.copilot/assistant/.ado-pat) — optional
#   3. a fresh AAD token minted from `az` for the org's tenant (the default path)

param([string]$Command = '')

# NOTE: $ErrorActionPreference is intentionally NOT set globally here. When this file
# is dot-sourced by the launcher, a global set would leak into the caller's scope and
# silently swallow its errors. It is scoped per branch below (saved/restored on the
# dot-source path; set locally on the CLI path, which runs as its own process).

# Well-known Azure DevOps Entra application/resource ID (stable across all tenants/orgs).
$script:AdoResource    = '499b84ac-1321-427f-aa17-267ca6975798'
. (Join-Path $PSScriptRoot '../../../shared/assistant-config.ps1')
try {
  $script:AdoConfig = Get-MnmAssistantConfigPath
  $null = Read-MnmAssistantConfig $script:AdoConfig
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  if (-not $Command) { return }
  exit 1
}
$script:AdoDefaultFile = if ($env:COPILOT_PLUGIN_ADO_PAT_FILE) { $env:COPILOT_PLUGIN_ADO_PAT_FILE } else { Join-Path $HOME '.copilot/assistant/.ado-pat' }
$script:AdoTenantCache = if ($env:COPILOT_PLUGIN_ADO_TENANT_CACHE) { $env:COPILOT_PLUGIN_ADO_TENANT_CACHE } else { Join-Path $HOME '.copilot/assistant/.ado-tenant' }

function Get-AdoCfg([string]$prop) {
  if (-not (Test-Path $script:AdoConfig)) { return '' }
  try {
    $cfg = Get-Content -Raw $script:AdoConfig | ConvertFrom-Json
    $v = $cfg.ado.$prop
    if ($v) { return [string]$v }
  } catch { }
  return ''
}

function Expand-AdoTilde([string]$p) {
  if ($p -eq '~') { return $HOME }
  if ($p -like '~/*' -or $p -like '~\*') { return (Join-Path $HOME $p.Substring(2)) }
  return $p
}

# Resolve a config-supplied path to an absolute path. A leading ~ is expanded; a
# still-relative path is anchored under ~/.copilot/assistant (NEVER the cwd, so a
# secret can't be dropped into whatever repo the session happens to run from).
function Resolve-AdoPath([string]$p) {
  $e = Expand-AdoTilde $p
  if ([System.IO.Path]::IsPathRooted($e)) { return $e }
  return (Join-Path $HOME (Join-Path '.copilot/assistant' $e))
}

function Resolve-AdoPatFile {
  $pf = Get-AdoCfg 'patFile'
  if ($pf) { return (Resolve-AdoPath $pf) }
  return $script:AdoDefaultFile
}

# Stored PAT (env override / patFile / patEnv / default file). '' when none.
function Read-AdoPat {
  if ($env:AZURE_DEVOPS_EXT_PAT) { return $env:AZURE_DEVOPS_EXT_PAT }
  $pf = Get-AdoCfg 'patFile'
  if ($pf) {
    $pf = Resolve-AdoPath $pf
    if (Test-Path $pf) { $v = (Get-Content -Raw $pf).Trim(); if ($v) { return $v } }
  }
  $envName = Get-AdoCfg 'patEnv'
  if ($envName -and $envName -match '^[A-Za-z_][A-Za-z0-9_]*$') {
    $v = [Environment]::GetEnvironmentVariable($envName)
    if ($v) { return $v }
  }
  if (Test-Path $script:AdoDefaultFile) { $v = (Get-Content -Raw $script:AdoDefaultFile).Trim(); if ($v) { return $v } }
  return ''
}

function Test-AdoFileHasContent([string]$f) {
  if (-not ($f) -or -not (Test-Path $f)) { return $false }
  $v = (Get-Content -Raw $f -ErrorAction SilentlyContinue)
  return [bool]($v -and $v.Trim())
}

# Detect the org's backing Entra tenant from its unauthenticated 401 challenge
# (Azure DevOps advertises X-VSS-ResourceTenant). Uses the real curl binary when
# present (NOT the Windows PowerShell curl->Invoke-WebRequest alias), else falls back
# to Invoke-WebRequest and reads the challenge response headers.
function Get-AdoDetectTenant([string]$org) {
  if (-not $org) { return '' }
  $headerText = ''
  $curl = Get-Command curl -CommandType Application -ErrorAction SilentlyContinue
  if (-not $curl) { $curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue }
  if ($curl) {
    try { $headerText = (& $curl.Source -sSI --max-time 6 $org 2>$null | Out-String) } catch { }
  }
  if (-not $headerText) {
    try {
      $resp = Invoke-WebRequest -Uri $org -Method Head -MaximumRedirection 0 -ErrorAction Stop
      $headerText = (($resp.Headers.GetEnumerator() | ForEach-Object { "$($_.Key): $($_.Value)" }) -join "`n")
    } catch {
      if ($_.Exception.Response) {
        try { $headerText = ($_.Exception.Response.Headers.ToString()) } catch { }
      }
    }
  }
  foreach ($line in ($headerText -split "`r?`n")) {
    if ($line -match '(?i)^X-VSS-ResourceTenant:\s*([0-9a-fA-F-]+)') { return $Matches[1].Trim() }
  }
  return ''
}

# Resolve the tenant to mint an org token for: config ado.tenantId else cached detection
# else fresh detection (cached). '' when undetectable.
function Get-AdoOrgTenant([string]$org) {
  $tid = Get-AdoCfg 'tenantId'
  if ($tid) { return $tid }
  if (-not $org) { return '' }
  if (Test-Path $script:AdoTenantCache) {
    foreach ($line in (Get-Content $script:AdoTenantCache -ErrorAction SilentlyContinue)) {
      $parts = $line -split "`t", 2
      if ($parts.Count -eq 2 -and $parts[0] -eq $org -and $parts[1]) { return $parts[1].Trim() }
    }
  }
  $tid = Get-AdoDetectTenant $org
  if ($tid) {
    try {
      $dir = Split-Path -Parent $script:AdoTenantCache
      New-Item -ItemType Directory -Path $dir -ErrorAction SilentlyContinue | Out-Null
      Add-Content -Path $script:AdoTenantCache -Value ("{0}`t{1}" -f $org, $tid)
      if ($IsLinux -or $IsMacOS) { & chmod 600 $script:AdoTenantCache 2>$null }
    } catch { }
    return $tid
  }
  return ''
}

# A logged-in subscription whose home tenant is the org's tenant. Pinning a subscription
# (not --tenant) makes get-access-token use THAT account+tenant regardless of the active
# default — so a personal/MSA default doesn't trip AADSTS50020. '' when none.
function Get-AdoOrgSubscription([string]$tid) {
  if (-not $tid) { return '' }
  $sub = (az account list --all --query "[?tenantId=='$tid' && state=='Enabled'].id | [0]" -o tsv 2>$null)
  if ($sub) { return $sub.Trim() }
  $sub = (az account list --all --query "[?tenantId=='$tid'].id | [0]" -o tsv 2>$null)
  if ($sub) { return $sub.Trim() }
  return ''
}

# Mint a fresh AAD token for the ADO resource in the org's tenant. '' when az is absent
# or no usable login exists. Does NOT switch the active subscription.
function Get-AdoAadToken {
  if (-not (Get-Command az -ErrorAction SilentlyContinue)) { return '' }
  $org = Get-AdoCfg 'org'
  $tid = Get-AdoOrgTenant $org
  $tok = ''
  if ($tid) {
    $sub = Get-AdoOrgSubscription $tid
    if ($sub) {
      $tok = (az account get-access-token --subscription $sub --resource $script:AdoResource --query accessToken -o tsv 2>$null)
    } else {
      $tok = (az account get-access-token --tenant $tid --resource $script:AdoResource --query accessToken -o tsv 2>$null)
    }
  } else {
    $tok = (az account get-access-token --resource $script:AdoResource --query accessToken -o tsv 2>$null)
  }
  if ($tok) { return $tok.Trim() }
  return ''
}

# Stored PAT first (explicit), else a fresh AAD token. '' when none.
function Resolve-AdoToken {
  $t = Read-AdoPat
  if ($t) { return $t }
  return (Get-AdoAadToken)
}

function Get-AdoTokenSource {
  if ($env:AZURE_DEVOPS_EXT_PAT) { return 'env:AZURE_DEVOPS_EXT_PAT' }
  $pf = Get-AdoCfg 'patFile'
  if ($pf) { $pf = Resolve-AdoPath $pf; if (Test-AdoFileHasContent $pf) { return "PAT file:$pf (ado.patFile)" } }
  $envName = Get-AdoCfg 'patEnv'
  if ($envName -and $envName -match '^[A-Za-z_][A-Za-z0-9_]*$' -and [Environment]::GetEnvironmentVariable($envName)) { return "PAT env:$envName (ado.patEnv)" }
  if (Test-AdoFileHasContent $script:AdoDefaultFile) { return "PAT file:$($script:AdoDefaultFile) (default)" }
  if (Get-Command az -ErrorAction SilentlyContinue) {
    $tid = Get-AdoOrgTenant (Get-AdoCfg 'org')
    if ($tid) { return "AAD via az (tenant $tid)" } else { return 'AAD via az (tenant active)' }
  }
  return ''
}

function Export-AdoAuth {
  $tok = Resolve-AdoToken
  if ($tok) { $env:AZURE_DEVOPS_EXT_PAT = $tok; return $true }
  return $false
}

# Scope-faithful probe: a work-item read (what the sync does), else a project list.
function Test-AdoProbe([string]$org) {
  $proj = Get-AdoCfg 'project'
  if ($proj) {
    az boards query --org $org --project $proj --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='$proj' ORDER BY [System.Id] DESC" --query "[0].id" -o tsv *> $null
  } else {
    az devops project list --org $org --top 1 *> $null
  }
  return ($LASTEXITCODE -eq 0)
}

# ---- DOT-SOURCED MODE: establish the auth context and return (no exit). ---------------
# Save/restore $ErrorActionPreference so swallowing errors here never leaks into the
# launcher that dot-sources this file.
if (-not $Command) {
  $__prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try { [void](Export-AdoAuth) } finally { $ErrorActionPreference = $__prevEAP }
  return
}

# ---- INVOKED MODE: CLI. --------------------------------------------------------------
# This path runs as its own process, so setting the preference here cannot affect a caller.
$ErrorActionPreference = 'SilentlyContinue'
switch ($Command) {
  'status' {
    $org = Get-AdoCfg 'org'
    Write-Output 'ado-session-sync - auth context'
    Write-Output ("  org:      " + ($(if ($org) { $org } else { '(ado.org not set in config)' })))
    $tid = ''
    if ($org) {
      $tid = Get-AdoOrgTenant $org
      Write-Output ("  tenant:   " + ($(if ($tid) { $tid } else { '(undetected - set ado.tenantId or check network)' })))
    }
    $src = Get-AdoTokenSource
    if ($src) { Write-Output "  auth:     $src" }
    else { Write-Output '  auth:     none available - `az login` to the org tenant, or `ado-auth.ps1 set` a PAT' }
    if (Get-Command az -ErrorAction SilentlyContinue) {
      $who = (az account show --query 'user.name' -o tsv 2>$null)
      $atid = (az account show --query 'tenantId' -o tsv 2>$null)
      Write-Output ("  az login: " + ($(if ($who) { $who } else { '(not logged in)' })) + ($(if ($atid) { " / tenant $atid" } else { '' })) + "   (active subscription - not switched by this tool)")
      if ($org -and (Export-AdoAuth)) {
        if (Test-AdoProbe $org) { Write-Output "  probe:    OK - authorizes $org" }
        else { Write-Output "  probe:    FAILED - not authorized for $org (try: az login --tenant $($(if($tid){$tid}else{'<tenant>'})))" }
      }
    } else {
      Write-Output '  az login: az not on PATH'
    }
    exit 0
  }
  'tenant' {
    $org = Get-AdoCfg 'org'
    if (-not $org) { Write-Error 'ado.org not set in config'; exit 1 }
    $tid = Get-AdoOrgTenant $org
    if ($tid) { Write-Output $tid; exit 0 }
    Write-Error "Could not detect tenant for $org (check network, or set ado.tenantId)"; exit 1
  }
  'set' {
    $pf = Resolve-AdoPatFile
    $dir = Split-Path -Parent $pf
    New-Item -ItemType Directory -Path $dir -ErrorAction SilentlyContinue | Out-Null
    $org = Get-AdoCfg 'org'
    Write-Host ("Storing an Azure DevOps PAT for " + ($(if ($org) { $org } else { 'the configured org' })) + " (optional fallback)")
    Write-Host 'The default auth path needs no PAT. Use this only if your org allows PATs and you prefer one.'
    Write-Host 'It needs Work Items (Read & Write) scope. Create one at:'
    Write-Host ("  " + ($(if ($org) { $org } else { '<org>' })) + "/_usersSettings/tokens")
    $sec = Read-Host -AsSecureString 'Paste the PAT (input hidden)'
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $pat = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    if (-not $pat) { Write-Host 'No PAT entered; nothing written.'; exit 1 }
    if (Test-Path $pf) {
      $existing = Get-Item -LiteralPath $pf -Force -ErrorAction SilentlyContinue
      if ($existing -and $existing.LinkType) { Write-Host "Refusing to write through symlink $pf"; exit 1 }
    }
    Set-Content -Path $pf -Value $pat -NoNewline
    if ($IsLinux -or $IsMacOS) { & chmod 600 $pf 2>$null }
    Write-Host "Stored PAT in $pf. Verifying..."
    if ((Get-Command az -ErrorAction SilentlyContinue) -and $org) {
      $env:AZURE_DEVOPS_EXT_PAT = $pat
      if (Test-AdoProbe $org) { Write-Host "OK - PAT authorizes $org. The session-yield sync will prefer it." }
      else { Write-Host "WARNING - could not verify against $org (check the PAT scope/expiry/org)." }
    }
    exit 0
  }
  'path' { Write-Output (Resolve-AdoPatFile); exit 0 }
  { $_ -in @('help', '-h', '--help') } {
    Get-Content $PSCommandPath | Select-Object -First 22 | ForEach-Object { $_ -replace '^# ?', '' }
    exit 0
  }
  default {
    Write-Output "Unknown command: $Command"
    exit 2
  }
}
