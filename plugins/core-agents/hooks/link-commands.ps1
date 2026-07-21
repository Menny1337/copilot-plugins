# link-commands.ps1 — expose this plugin's CLI command(s) on PATH (sessionStart). Best-effort.
#
# PowerShell parity for link-commands.sh. Copilot plugins have no native command->PATH
# installer, so this hook self-provisions the plugin's command(s) the same way the repo's
# other sessionStart hooks do. On Windows, symlinks need admin/dev-mode, so instead of
# linking we write a tiny .cmd shim (`node "<script>" %*`) into %USERPROFILE%\.local\bin for
# each declared command — the cross-platform analog of ~/.local/bin.
#
# The script(s) stay in their owning skill's scripts/ dir (single source of truth); this hook
# only exposes them on PATH. To expose another command, add its plugin-relative path to
# $commands below. The PATH name is the file's basename minus its script extension.
#
# Dot-sourced by the hook runner (repo convention): saves/restores $ErrorActionPreference and
# uses `return` (never `exit`) to stay best-effort and never block startup. Announces via one
# { "additionalContext": "..." } line ONLY when it creates/updates a shim (or the target dir
# is not on PATH). Never clobbers a shim it does not own (marker-gated).

$__prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
try {
  # Plugin-relative paths to the command script(s) this plugin exposes on PATH.
  # NOTE: this Windows hook shims commands as `node "<script>"`, so it can only expose
  # node scripts (.mjs/.js). POSIX/bash-only commands (ado-session-sync's sync-status.sh
  # and ado-auth.sh) are exposed on PATH by link-commands.sh and intentionally omitted here.
  $commands = @(
    'skills/assistant-capture/scripts/assistant-store.mjs'
    'skills/assistant-query/scripts/ado-query.mjs'
    'skills/ado-session-sync/scripts/sync-ui.mjs'
  )

  # Run-once-per-session guard (see link-commands.sh): de-dupe multiple invocations in one
  # session on the sessionStart stdin payload's sessionId via a directory lock. On any
  # failure or missing sessionId, run normally.
  $__sid = ''
  if ([Console]::IsInputRedirected) {
    $__payload = [Console]::In.ReadToEnd()
    if ($__payload -match '"sessionId"\s*:\s*"([A-Za-z0-9._-]+)"') { $__sid = $Matches[1] }
  }
  if ($__sid) {
    $__lock = Join-Path ([System.IO.Path]::GetTempPath()) "link-commands.$__sid"
    try { New-Item -ItemType Directory -Path $__lock -ErrorAction Stop | Out-Null }
    catch { return }
  }

  $hookDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
  $pluginDir = (Resolve-Path -LiteralPath (Join-Path $hookDir '..')).Path
  $destDir   = Join-Path $env:USERPROFILE '.local\bin'
  New-Item -ItemType Directory -Path $destDir -ErrorAction SilentlyContinue | Out-Null
  if (-not (Test-Path -LiteralPath $destDir)) { return }

  $marker     = ':: link-commands'   # identifies shims this hook owns
  $scriptExts = @('.mjs', '.cjs', '.js', '.sh', '.ps1', '.cmd', '.bat')
  $linked     = New-Object System.Collections.Generic.List[string]

  foreach ($rel in $commands) {
    $rel = $rel.Trim()
    if (-not $rel) { continue }
    $src = Join-Path $pluginDir ($rel -replace '/', '\')
    if (-not (Test-Path -LiteralPath $src)) { continue }
    $real = (Resolve-Path -LiteralPath $src).Path
    $base = Split-Path -Leaf $real

    $cmd = $base
    $ext = [System.IO.Path]::GetExtension($base)
    if ($scriptExts -contains $ext) { $cmd = [System.IO.Path]::GetFileNameWithoutExtension($base) }
    if (-not $cmd) { continue }

    $shim = Join-Path $destDir ($cmd + '.cmd')
    $content = "@echo off`r`n$marker`r`nnode `"$real`" %*`r`n"

    if (Test-Path -LiteralPath $shim) {
      $existing = Get-Content -LiteralPath $shim -Raw -ErrorAction SilentlyContinue
      if ($existing -notmatch [regex]::Escape($marker)) { continue }   # foreign — never clobber
      if ($existing -eq $content) { continue }                         # already correct
    }
    Set-Content -LiteralPath $shim -Value $content -Encoding ASCII -NoNewline -ErrorAction SilentlyContinue
    if ($?) { $linked.Add($cmd) | Out-Null }
  }

  # Self-heal: remove our own shims whose target no longer exists (e.g. plugin uninstalled).
  foreach ($s in (Get-ChildItem -LiteralPath $destDir -Filter '*.cmd' -File -ErrorAction SilentlyContinue)) {
    $txt = Get-Content -LiteralPath $s.FullName -Raw -ErrorAction SilentlyContinue
    if ($txt -notmatch [regex]::Escape($marker)) { continue }
    if ($txt -match 'node\s+"([^"]+)"') {
      if (-not (Test-Path -LiteralPath $Matches[1])) { Remove-Item -LiteralPath $s.FullName -ErrorAction SilentlyContinue }
    }
  }

  if ($linked.Count -eq 0) { return }   # nothing changed — stay silent

  $list = [string]::Join(', ', ($linked | Sort-Object -Unique))
  $pathNote = ''
  if (-not (($env:PATH -split ';') -contains $destDir)) {
    $pathNote = " NOTE: $destDir is not on your PATH - add it to use the command(s) directly."
  }
  $msg = "[core-agents - sessionStart] Linked plugin command(s) on PATH in %USERPROFILE%\.local\bin: $list. Run ``<cmd> --help`` to get started.$pathNote"
  [pscustomobject]@{ additionalContext = $msg } | ConvertTo-Json -Compress
}
finally {
  $ErrorActionPreference = $__prevEAP
}
