# Narration recipes

All commands use paths relative to the loaded skill directory. Resolve the
absolute script path before running from another working directory.
Synthesize only from a saved narration script.

## Contents

- Setup and readiness
- Configuration and precedence
- Choose output paths
- Full narration and timed briefs
- Voice presets and preview
- Resume interrupted work
- Troubleshooting
- Offline regression tests

## Setup and readiness

Audio needs Python 3.11+, `requests`, `ffmpeg` with the `setts` bitstream filter,
and `ffprobe`. The offline plan checks this filter before any synthesis. Bearer
authentication and Azure discovery also need `az`. Install missing dependencies
only after identifying what is missing; use the environment's package manager
or virtual environment rather than changing system Python.

Inspect configuration without displaying secrets:

```bash
python3 scripts/synthesize_tts.py config show
```

For an explicitly selected Azure resource, discover its endpoint and deployed
model, then save configuration without terminal prompts:

```bash
python3 scripts/synthesize_tts.py setup \
  --subscription "<subscription-id>" \
  --resource-group "<resource-group>" \
  --account "<account-name>" \
  --deployment "<deployment-name>" \
  --non-interactive
```

These are read-only Azure queries. They do not create deployments, change the
active subscription, or retrieve API keys. Deployment names can be aliases;
setup stores the model identity returned by Azure.

For a known endpoint without discovery:

```bash
python3 scripts/synthesize_tts.py setup \
  --endpoint "https://<resource>.cognitiveservices.azure.com" \
  --deployment "<deployment-name>" \
  --model tts-hd \
  --voice nova \
  --speed 1.0 \
  --auth-mode bearer \
  --non-interactive
```

Run `az login` separately if bearer authentication is not ready. For API-key
authentication, choose `--auth-mode api-key` and supply the key through
`NARRATE_AZURE_OPENAI_API_KEY` or the existing macOS Keychain integration.
Do not put keys in command arguments or config files.

Interactive `setup` remains available in a human-controlled terminal. To
replace existing configuration without prompts, obtain approval first, then
add `--force`. A one-off render must not save new preferences automatically.
Do not add this flag merely because a command failed; config replacement
and audio replacement require separate, specific authorization.

After setup, an explicit online check is available:

```bash
python3 scripts/synthesize_tts.py doctor
```

This checks readiness, not audio quality or guaranteed quota. It does not
generate speech. Dry-run is the separate offline plan and never authenticates
or contacts Azure.

## Configuration and precedence

Configuration lives in `~/.config/narrate/config.toml`, respecting
`XDG_CONFIG_HOME`. Override it with `NARRATE_CONFIG_PATH` or `--config`.
Keep this personal configuration outside the repository.

Resolution uses CLI options, then environment, then saved configuration,
then built-in defaults. The defaults remain `tts-hd`, `nova`, speed `1.0`,
and bearer authentication.

Existing environment overrides remain supported:
`AZURE_OPENAI_ENDPOINT`, `NARRATE_TTS_DEPLOYMENT`,
`NARRATE_TTS_API_VERSION`, `NARRATE_TTS_VOICE`, `NARRATE_TTS_SPEED`,
`NARRATE_AUTH_MODE`, and `NARRATE_AZURE_OPENAI_API_KEY`.

An explicit `--preset` supplies voice/speed at the CLI layer; individual
`--voice` and `--speed` flags win over it. Without a preset, saved voice and
speed continue to work. Use setup to persist a requested voice preference.

`tts` and `tts-hd` are supported model identities, separate from deployment
aliases. Realtime and transcription deployments are not compatible with this
wrapper. No model is automatically substituted.

## Choose output paths

Before authoring, get the paired transcript and audio destinations:

```bash
python3 scripts/synthesize_tts.py output-path "/path/to/report.md"
python3 scripts/synthesize_tts.py output-path "/path/to/report.md" \
  --output-dir "/path/to/audio"
```

The output is JSON. For a source outside a repository, defaults are
`report.narration.md` and `report.mp3` beside the source. For a repository
source, defaults use a source-specific folder under
`$XDG_DATA_HOME/narrate/outputs` (normally `~/.local/share/narrate/outputs`).
This avoids collisions between equal filenames in different source folders.
Audio, transcripts, and previews remain there until deliberately removed.
Include their locations in the result; requesting final artifacts does not
authorize retaining extra intermediate chunks.

For variants, use `report.short-brief.narration.md` and
`report.short-brief.mp3`, or the corresponding `summary-overview` or
`opener-1min` suffix. Check both files before authoring; do not overwrite a
source or an existing transcript.

The synthesis output argument is now optional and follows the same naming
rules. Both existing explicit forms still work:

```bash
python3 scripts/synthesize_tts.py "/path/to/report.narration.md" "/path/to/report.mp3"
python3 scripts/synthesize_tts.py "/path/to/report.narration.md" --output "/path/to/report.mp3"
```

Explicit repository destinations still need `--allow-tracked`. That flag
does not add files to `.gitignore`; do so deliberately when appropriate.
`--force` permits replacing existing output, never replacing the source.

## Full narration and timed briefs

Save the script first, following `script-style-guide.md`, then:

```bash
python3 scripts/synthesize_tts.py --dry-run "/path/to/report.narration.md"
python3 scripts/synthesize_tts.py "/path/to/report.narration.md"
```

Use exactly the same options for dry-run and synthesis. Offline validation
catches invalid settings, missing local prerequisites, and unsafe output
paths. Its duration estimate does not prove that the final file fits a limit.
An estimate over the cap prints a warning; tighten the script before rendering.
The estimate alone does not reject a render because only measured audio can
prove whether the cap is met.

For a brief that must be at most 3 minutes:

```bash
python3 scripts/synthesize_tts.py --dry-run --max-duration 180 \
  "/path/to/report.short-brief.narration.md"
python3 scripts/synthesize_tts.py --max-duration 180 \
  "/path/to/report.short-brief.narration.md"
```

Use `--max-duration 60` for a hard one-minute opener. The wrapper measures
audio before publishing. If it exceeds the cap, the run fails without
publishing that final MP3. Shorten the script and run again; do not truncate
the audio or silently speed it up. Existing output remains protected.
Use a new revision basename for the revised transcript and audio, and follow
the measured-duration reduction rule and two-retry limit in `SKILL.md`.

## Voice presets and preview

Presets are supported voice/speed combinations, not model style prompts:

```bash
python3 scripts/synthesize_tts.py --preset calm "/path/to/report.narration.md"
python3 scripts/synthesize_tts.py --preset conversational \
  --voice nova --speed 0.95 "/path/to/report.narration.md"
```

Use `--preview` to render a short beginning of the script as separate files:

```bash
python3 scripts/synthesize_tts.py --dry-run --preview --preset calm \
  "/path/to/report.narration.md"
python3 scripts/synthesize_tts.py --preview --preset calm \
  "/path/to/report.narration.md"
```

The preview MP3 has its own matching transcript. For a short brief, these are
`report.short-brief.preview.mp3` and
`report.short-brief.preview.narration.md`. Do not overwrite or rename the
sample as the completed full narration. Return it and wait before rendering
the whole script unless the user explicitly requested both without an
approval pause.

There is no automatic playback. If the user chooses this voice for future
runs, persist it through setup with approved config replacement.

## Resume interrupted work

Opt in by choosing a persistent job directory outside the repository:

```bash
python3 scripts/synthesize_tts.py --dry-run \
  --resume-dir "/path/to/private-narration-jobs" \
  "/path/to/report.narration.md"
python3 scripts/synthesize_tts.py \
  --resume-dir "/path/to/private-narration-jobs" \
  "/path/to/report.narration.md"
```

After interruption, repeat the same command. The wrapper reuses validated
chunks only when the script and synthesis settings match. Changed text,
voice, speed, endpoint, model, or chunking selects a different job.

The directory retains audio on success and failure. Its manifest must not
contain credentials or the full script, but the audio itself can contain
sensitive content. Obtain consent for retention and report the job location.
Without `--resume-dir`, chunks are temporary.

If a job is locked, report the exact job and stop. The agent must not break
locks or wait indefinitely. A human can investigate the owning process
before following the error's recovery guidance. Do not delete broad cache
directories or remove another active run's lock.

Once no longer needed, remove only the explicitly identified job directory.
The wrapper does not silently remove retained jobs. `--force` is still
required to replace an already published MP3 during a repeat run.

## Troubleshooting

| Failure | Action |
|---|---|
| Endpoint missing | Run setup with an explicit resource or endpoint |
| Existing config in non-interactive setup | Reuse it, or approve replacement and add `--force` |
| Unsupported model or voice | Select a supported setting; do not substitute a different deployment silently |
| Local dependency missing | Install only that dependency in the intended environment |
| Offline plan passes but authentication fails | Run `doctor`; refresh authentication or repair access |
| Existing audio or transcript | Choose a new destination or explicitly approve replacement |
| HTTP 429 or exhausted retry budget | Wait, then rerun with the same opted-in resume directory; without one, the whole script is synthesized again |
| Audio exceeds maximum duration | Tighten the script, then re-plan and re-render |
| Corrupt cached audio or mismatched metadata | Follow the error guidance for that exact job; never merge chunks manually |

## Offline regression tests

Run the bundled standard-library tests without Azure credentials:

```bash
python3 -m unittest discover -s scripts -p 'test_synthesize_tts.py'
```

The tests mock speech requests. They are not evidence of voice quality.
