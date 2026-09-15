# ado-sync-advisory.ps1 — sessionStart advisory for ado-session-sync (Windows parity).
#
# Injects { "additionalContext": "..." } summarizing ado-session-sync outcomes since
# you last saw them. Watermarked (seen.watermark); silent when disabled, when nothing
# is new, or on the first run (baseline only). Best-effort; always exits 0.
#
# Timestamps (.ts / legacy .timestamp) are normalized deterministically to canonical
# UTC ISO-8601 strings (see ConvertTo-CanonicalTs/-DateTimeOrNull below) before latest-
# event selection, watermark comparison, and watermark writes — PowerShell's
# ConvertFrom-Json silently coerces ISO-8601-looking JSON strings to [DateTime], and a
# naive re-stringify of that renders in the CURRENT CULTURE's locale format (not
# ISO-8601), which corrupted seen.watermark and broke every later comparison against
# it. Ordering/"is this new" decisions compare parsed [DateTime] values chronologically
# rather than raw strings. ConvertTo-DateTimeOrNull treats ISO-8601-SHAPED strings
# (yyyy-MM-ddTHH:mm:ss...) as UTC/explicit-offset (AssumeUniversal+AdjustToUniversal)
# but treats any OTHER string — i.e. a legacy, pre-fix locale-formatted wall-clock
# watermark like "01/01/2020 11:30:00" — as LOCAL time (AssumeLocal+AdjustToUniversal),
# since that is what such a string actually represents. Conflating the two (using
# AssumeUniversal for both) would silently shift a recovered legacy watermark by the
# local UTC offset and could permanently hide real unseen events.
#
# Fail-open on anything unparseable: an on-disk watermark that cannot be parsed as
# ANY date at all (hand-corrupted garbage, e.g. "zzz") is NEVER compared lexically —
# canonical ISO-8601 strings sort lexically before many garbage strings, so a raw
# string compare could misclassify every real event as "older", emit nothing, and
# still advance the watermark past them, permanently losing them. Instead every
# event is treated as new for that one run, and the canonical latest watermark is
# (re)written so later runs resume normal chronological comparison. Likewise, an
# individual event whose OWN timestamp can't be parsed is always treated as new
# (never silently dropped forever). "Latest" (used for both the first-run baseline
# and every later watermark advance) is derived ONLY from events with a parseable
# timestamp — if NOT EVEN ONE event in a run has a parseable timestamp, there is no
# real instant to anchor a watermark to, so seen.watermark is left completely
# untouched (neither created nor advanced) that run, while the malformed event(s)
# are still surfaced per the fail-open policy above.
#
# Any ADO_SESSION_SYNC, COPILOT_PLUGIN_GITHUB_SESSION_SYNC or COPILOT_PLUGIN_TASK_SESSION_SYNC value
# of 0 disables before payload, lock or watermark access. A value of 1 overrides
# opt-in only for a valid selected remote backend. Otherwise the selected
# backend's sync block must have enabled=true. Local Markdown remains inert.

# Force-disable, checked before ANYTHING else touches disk (payload/lock/watermark).
if ($env:ADO_SESSION_SYNC -eq '0' -or $env:COPILOT_PLUGIN_GITHUB_SESSION_SYNC -eq '0' -or $env:COPILOT_PLUGIN_TASK_SESSION_SYNC -eq '0') { exit 0 }

try {
  $logDir = Join-Path $HOME '.copilot/logs/ado-session-sync'
  $jsonl  = Join-Path $logDir 'runs.jsonl'
  $wm     = Join-Path $logDir 'seen.watermark'
  try {
    . (Join-Path $PSScriptRoot '../shared/assistant-config.ps1')
    $config = Get-MnmAssistantConfigPath
    $cfg = Read-MnmAssistantConfig $config
    $backend = Get-MnmAssistantBackend $cfg
  } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 0 }
  if ($backend -eq 'markdown') { exit 0 }

  # Opt-in (env=0 already exited above). Backend-neutral: ado (legacy) OR github.
  $enabled = $false
  if ($env:ADO_SESSION_SYNC -eq '1' -or $env:COPILOT_PLUGIN_GITHUB_SESSION_SYNC -eq '1' -or $env:COPILOT_PLUGIN_TASK_SESSION_SYNC -eq '1') {
    $enabled = $true
  } elseif (Test-Path $config) {
    try {
      $cfg = Get-Content -Raw $config | ConvertFrom-Json
      if ($cfg.adoSessionSync.enabled -is [bool] -and $cfg.adoSessionSync.enabled -eq $true -and $cfg.taskBackend -eq 'ado') { $enabled = $true }
      elseif ($cfg.taskSessionSync.enabled -is [bool] -and $cfg.taskSessionSync.enabled -eq $true -and $cfg.taskBackend -eq 'github') { $enabled = $true }
    } catch { }
  }
  if (-not $enabled) { exit 0 }
  if (-not (Test-Path $jsonl)) { exit 0 }

  $payload = ''
  try { if ([Console]::IsInputRedirected) { $payload = [Console]::In.ReadToEnd() } } catch { $payload = '' }
  $sid = ''
  if ($payload -match '"sessionId"\s*:\s*"([A-Za-z0-9._-]+)"') { $sid = $Matches[1] }
  if ($sid) {
    $lock = Join-Path ([System.IO.Path]::GetTempPath()) "ado-advisory.$sid"
    try { New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null } catch { exit 0 }
  }

  # --- Deterministic timestamp normalization -------------------------------------
  # PowerShell's ConvertFrom-Json silently coerces ISO-8601-looking JSON string
  # values (like this log's .ts/.timestamp fields) to [DateTime] objects. The VALUE
  # is correct (it represents the right instant, including timezone-offset inputs),
  # but naively re-stringifying it (implicit [string]$dt / string interpolation)
  # uses the CURRENT CULTURE's locale format (e.g. "01/01/2020 0:00:00"), not
  # ISO-8601 — corrupting seen.watermark and breaking every later lexical/string
  # comparison against it. Fix: always convert through these two helpers so the
  # in-memory representation is a real [DateTime] for chronological comparisons,
  # and anything written to disk (or compared textually) is always re-emitted as
  # a canonical, invariant-culture UTC ISO-8601 string — regardless of whether the
  # runtime value at this point is a coerced [DateTime] or a plain [string].
  function ConvertTo-DateTimeOrNull($value) {
    if ($null -eq $value) { return $null }
    if ($value -is [DateTime]) { return $value.ToUniversalTime() }
    $s = [string]$value
    if ([string]::IsNullOrWhiteSpace($s)) { return $null }
    $parsed = [DateTime]::MinValue

    # Case 1: the string is ISO-8601-shaped (yyyy-MM-ddTHH:mm:ss[...][Z|+HH:mm|-HH:mm]) —
    # this is what this script itself always writes, and what a well-formed upstream
    # .ts value looks like. Parse with InvariantCulture. AssumeUniversal only affects
    # the (never emitted by us, but tolerated) case of a bare ISO string with NO
    # explicit offset — treated as UTC by convention. AdjustToUniversal ALWAYS honors
    # an explicit Z/offset when present, so a genuine offset (e.g. "-04:00") is
    # converted to the correct UTC instant, never reinterpreted as if it were UTC.
    if ($s -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}') {
      $isoStyles = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal
      if ([DateTime]::TryParse($s, [System.Globalization.CultureInfo]::InvariantCulture, $isoStyles, [ref]$parsed)) { return $parsed }
      return $null
    }

    # Case 2: anything else is assumed to be a legacy, CURRENT-CULTURE-locale-
    # formatted WALL-CLOCK string (e.g. "01/01/2020 11:30:00 AM") left behind by a
    # prior (pre-fix) run of this exact script. It carries NO timezone information
    # and represents LOCAL time on the machine that wrote it — NOT UTC. Using
    # AssumeUniversal here (the original bug) would misinterpret that local
    # wall-clock reading as if it were already UTC, silently shifting the recovered
    # instant by the local UTC offset — which can advance the watermark PAST real
    # unseen events and permanently hide them. AssumeLocal correctly interprets the
    # text as local wall-clock, and AdjustToUniversal converts it using the CURRENT
    # system timezone, so an old corrupted watermark self-heals to the correct UTC
    # instant (and is rewritten in canonical form) on the very next run.
    $localStyles = [System.Globalization.DateTimeStyles]::AssumeLocal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal
    if ([DateTime]::TryParse($s, [System.Globalization.CultureInfo]::CurrentCulture, $localStyles, [ref]$parsed)) { return $parsed }
    return $null
  }
  function ConvertTo-CanonicalTs($value) {
    $dt = ConvertTo-DateTimeOrNull $value
    if ($dt) { return $dt.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [System.Globalization.CultureInfo]::InvariantCulture) }
    if ($null -eq $value) { return $null }
    $s = [string]$value
    if ([string]::IsNullOrWhiteSpace($s)) { return $null }
    return $s # non-empty but unparseable as any date — keep verbatim rather than dropping the event
  }

  $events = @()
  foreach ($l in Get-Content $jsonl) {
    try {
      $e = $l | ConvertFrom-Json
      $rawTs = $null
      if ($e.PSObject.Properties['ts'] -and $e.ts) { $rawTs = $e.ts }
      elseif ($e.PSObject.Properties['timestamp'] -and $e.timestamp) { $rawTs = $e.timestamp }
      $e | Add-Member -NotePropertyName ts -NotePropertyValue (ConvertTo-CanonicalTs $rawTs) -Force
      # Internal-only field (never written to disk or shown to the user): the
      # parsed [DateTime] backing chronological comparisons below.
      $e | Add-Member -NotePropertyName _dt -NotePropertyValue (ConvertTo-DateTimeOrNull $rawTs) -Force
      if (-not $e.parent -and $e.parentSession) { $e | Add-Member -NotePropertyName parent -NotePropertyValue ([string]$e.parentSession) -Force }
      if (-not $e.child -and $e.syncSession) { $e | Add-Member -NotePropertyName child -NotePropertyValue ([string]$e.syncSession) -Force }
      $events += $e
    } catch { }
  }
  if ($events.Count -eq 0) { exit 0 }

  # "Latest" = chronologically max ts across ALL events with a PARSEABLE timestamp
  # (robust to any out-of-order lines), not merely the last line in the file, and
  # NEVER derived from an event whose timestamp could not be parsed at all (see
  # below for why).
  $parseableEvents = $events | Where-Object { $_._dt }
  $latestEvent = $null
  if ($parseableEvents) { $latestEvent = $parseableEvents | Sort-Object { $_._dt } | Select-Object -Last 1 }
  $latest = if ($latestEvent) { $latestEvent.ts } else { $null }

  # If NOT EVEN ONE event in this run has any parseable timestamp, there is no
  # real instant anywhere to anchor a baseline/watermark to -- $latest is $null.
  # NEVER create or advance seen.watermark in that case: doing so (as a prior
  # version of this fix did, by picking an arbitrary malformed raw string as
  # "latest") would write a non-chronological, unparseable value that could
  # poison or reset every future comparison. Instead, skip ALL watermark
  # read/write entirely (both the first-run baseline-creation path and the
  # normal read-compare-advance path below) and fall straight through to
  # surfacing the malformed event(s) via the fail-open policy — they must still
  # be reported, not silently dropped just because nothing here is watermarkable.
  if ($latest) {
    if (-not (Test-Path $wm)) { Set-Content -Path $wm -Value $latest -NoNewline -ErrorAction SilentlyContinue; exit 0 }
    $lastSeenDt = ConvertTo-DateTimeOrNull (Get-Content -Raw $wm)

    # Chronological comparison via parsed [DateTime] whenever the on-disk watermark
    # parses as a real instant (true for every watermark this script itself ever
    # writes, since it always writes the canonical form -- and also true for a
    # legacy/locale-corrupted watermark, which ConvertTo-DateTimeOrNull self-heals
    # above). An event whose OWN timestamp could not be parsed at all (._dt is
    # $null) can never be safely placed before or after the watermark -- excluding
    # it would silently and PERMANENTLY drop real log activity on every single run,
    # forever. Instead it is always treated as new: it may be (re-)surfaced more
    # than once across runs, which is the intentionally safer failure mode (never
    # silently lost) versus indefinite, undetectable loss. (It can never poison the
    # watermark itself: $latest above is derived only from parseable events, so
    # such an event can never become the value written to seen.watermark.)
    #
    # If the on-disk watermark ITSELF is unparseable garbage (e.g. hand-corrupted
    # to "zzz"), there is NO safe instant to compare against, and a raw LEXICAL
    # string compare here is actively dangerous: canonical ISO-8601 strings (which
    # start with a digit, e.g. "2020-...") sort lexically BEFORE many garbage
    # strings (e.g. "zzz"), so comparing against garbage would misclassify every
    # real, valid event as "older" -- emitting nothing this run while STILL
    # advancing the watermark past them below, permanently losing them with no
    # trace. Fail open instead: when the watermark can't be parsed as any date,
    # treat every event as new for this one run — deliberately re-surfacing
    # anything already reported previously is safer than silently dropping
    # everything — then write the canonical latest watermark so subsequent runs
    # resume normal chronological comparison from a clean, parseable baseline.
    if ($lastSeenDt) {
      $new = $events | Where-Object { (-not $_._dt) -or ($_._dt -gt $lastSeenDt) }
    } else {
      $new = $events
    }
    Set-Content -Path $wm -Value $latest -NoNewline -ErrorAction SilentlyContinue
  } else {
    $new = $events
  }
  if (-not $new) { exit 0 }

  $updated = @($new | Where-Object { $_.event -eq 'result' -and $_.action -ne 'skipped' }).Count
  $skipped = @($new | Where-Object { $_.event -eq 'result' -and $_.action -eq 'skipped' }).Count
  $errors  = @($new | Where-Object { $_.event -eq 'error' -or ($_.event -eq 'child-exit' -and $_.exit -ne 0) }).Count

  if ($updated -eq 0 -and $errors -eq 0) { exit 0 }

  $parts = @()
  if ($updated -gt 0) { $parts += "$updated item(s) updated" }
  if ($skipped -gt 0) { $parts += "$skipped skipped" }
  if ($errors  -gt 0) { $parts += "$errors error(s)" }
  # Allowlist nudge (parity with .sh): surface (once) a productive repo that is syncing
  # but is NOT in adoSessionSync.syncRepos. Repos already in syncRepos are never nudged.
  $suggLine = ''
  try {
    $syncRepos = @()
    $syncBlock = if ($backend -eq 'github') { 'taskSessionSync' } else { 'adoSessionSync' }
    if ($cfg.$syncBlock.syncRepos) { $syncRepos = @($cfg.$syncBlock.syncRepos) }
    function Expand-Tilde2([string]$p) { if ($p -eq '~') { return $HOME } elseif ($p -like '~/*' -or $p -like '~\*') { return (Join-Path $HOME $p.Substring(2)) } else { return $p } }
    function In-Repos([string]$c) {
      foreach ($pfx in $syncRepos) { $pp = (Expand-Tilde2 ([string]$pfx)).TrimEnd('/', '\'); if ($c -eq $pp -or $c.StartsWith($pp + '/') -or $c.StartsWith($pp + '\')) { return $true } }
      return $false
    }
    $pcwd = @{}
    foreach ($e in $events) { if ($e.event -eq 'launch' -and $e.parent) { $pcwd[$e.parent] = ([string]$e.cwd) } }
    $prod = @{}
    foreach ($e in $events) {
      if ($e.event -eq 'result' -and ($e.action -in @('commented+tagged', 'state-nudged', 'tagged-only'))) {
        $cw = $pcwd[$e.parent]
        if ($cw -and -not (In-Repos $cw)) { if ($prod.ContainsKey($cw)) { $prod[$cw]++ } else { $prod[$cw] = 1 } }
      }
    }
    $cand = ($prod.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
    if ($cand) {
      $sugg = Join-Path $logDir 'suggested-repos'
      $already = (Test-Path $sugg) -and ((Get-Content $sugg) -contains $cand)
      if (-not $already) {
        Add-Content -Path $sugg -Value $cand -ErrorAction SilentlyContinue
        $suggLine = " Tip: '$cand' is syncing but not in $syncBlock.syncRepos — add it to always-sync (``sync-status --repos``)."
      }
    }
  } catch { }
  $msg = "ⓘ ado-session-sync: since you last looked, " + ($parts -join ', ') + "." + $suggLine + " Run ``sync-status --errors`` for detail."
  @{ additionalContext = $msg } | ConvertTo-Json -Compress
} catch { }
exit 0
