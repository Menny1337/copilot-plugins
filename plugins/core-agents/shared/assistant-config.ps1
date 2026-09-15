function Get-MnmAssistantConfigPath {
  $path = if ($env:COPILOT_PLUGIN_ASSISTANT_CONFIG) { $env:COPILOT_PLUGIN_ASSISTANT_CONFIG }
          elseif ($env:COPILOT_PLUGIN_ADO_CONFIG) { $env:COPILOT_PLUGIN_ADO_CONFIG }
          else { Join-Path $HOME '.copilot/assistant/config.json' }
  if ($path -eq '~') { $path = $HOME }
  elseif ($path -match '^~[/\\]') { $path = Join-Path $HOME $path.Substring(2) }
  return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path)
}

function Read-MnmAssistantConfig([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path) -and -not $env:COPILOT_PLUGIN_ASSISTANT_CONFIG -and -not $env:COPILOT_PLUGIN_ADO_CONFIG) {
    return [pscustomobject]@{}
  }
  try {
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    if (-not $raw -or -not $raw.TrimStart().StartsWith('{')) { throw 'object required' }
    $cfg = $raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw 'assistant config: selected file is missing, unreadable or invalid JSON; check COPILOT_PLUGIN_ASSISTANT_CONFIG (legacy COPILOT_PLUGIN_ADO_CONFIG) or the default config'
  }
  if ($cfg -isnot [pscustomobject]) { throw 'assistant config must be a JSON object' }
  return $cfg
}

function Get-MnmAssistantBackend($Config) {
  $backend = if ($Config.PSObject.Properties['taskBackend']) { $Config.taskBackend } else { 'markdown' }
  if ($backend -isnot [string] -or $backend -cnotin @('markdown', 'ado', 'github')) {
    throw 'assistant config.taskBackend must be "markdown", "ado" or "github"'
  }
  function Test-ConfigText($Value) { return ($Value -is [string] -and -not [string]::IsNullOrWhiteSpace($Value)) }
  if ($backend -eq 'ado' -and (-not (Test-ConfigText $Config.ado.org) -or -not (Test-ConfigText $Config.ado.project))) {
    throw 'configure ado.org and ado.project in the selected config'
  }
  if ($backend -eq 'github') {
    $g = $Config.github
    $number = 0.0
    if (-not (Test-ConfigText $g.owner) -or -not (Test-ConfigText $g.repo) -or
        $g.projectNumber -is [bool] -or $g.projectNumber -is [array] -or
        -not [double]::TryParse([string]$g.projectNumber, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number) -or
        $number -le 0 -or $number -gt 9007199254740991 -or [double]::IsNaN($number) -or [math]::Floor($number) -ne $number) {
      throw 'configure github.owner, github.repo and a positive integer github.projectNumber in the selected config'
    }
    if ($g.PSObject.Properties['ownerType'] -and $g.ownerType -cnotin @('user', 'org')) {
      throw 'config.github.ownerType must be "user" or "org"'
    }
  }
  return $backend
}
