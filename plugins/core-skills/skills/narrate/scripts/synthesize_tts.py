#!/usr/bin/env python3
"""Synthesize a narration script (.md) into spoken audio (.mp3).

Default backend: Azure OpenAI tts-hd (the proven path).
Backend seam: a `BACKENDS` dict mapping name -> synth function.

Subcommands:
  synthesize_tts.py setup                          # interactive first-time config
  synthesize_tts.py config show                    # print resolved config + sources
  synthesize_tts.py <script.md> <output.mp3> [opts]   # synthesize (default)
  synthesize_tts.py --dry-run <script.md> <output.mp3>

Configuration precedence (highest first):
  1. CLI flags
  2. Environment variables (AZURE_OPENAI_ENDPOINT, NARRATE_TTS_*)
  3. Config file (~/.config/narrate/config.toml, XDG-aware; override via
     NARRATE_CONFIG_PATH or --config)
  4. Built-in defaults

Auth modes:
  bearer   (default) — `az account get-access-token` against Cognitive Services.
  api-key            — read key from $NARRATE_AZURE_OPENAI_API_KEY, else from
                       macOS Keychain (service `narrate-azure-openai-api-key`,
                       account = endpoint hostname). Run `setup` to store it.

Env vars (all optional once config is written):
  AZURE_OPENAI_ENDPOINT        e.g. https://<resource>.cognitiveservices.azure.com
  NARRATE_TTS_DEPLOYMENT       (default: "tts-hd")
  NARRATE_TTS_API_VERSION      (default: "2025-03-01-preview")
  NARRATE_TTS_VOICE            (default: "nova")
  NARRATE_TTS_SPEED            (default: "1.0")
  NARRATE_AUTH_MODE            "bearer" | "api-key"  (default: "bearer")
  NARRATE_AZURE_OPENAI_API_KEY (api-key mode only)
  NARRATE_CONFIG_PATH          override config file path
"""

from __future__ import annotations

import argparse
import getpass
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None  # type: ignore

# requests is imported lazily inside the synth backend so --dry-run works
# without it installed.

# ----------------------------------------------------------------------------
# Defaults
# ----------------------------------------------------------------------------

DEFAULT_DEPLOYMENT = "tts-hd"
DEFAULT_API_VERSION = "2025-03-01-preview"
DEFAULT_VOICE = "nova"
DEFAULT_SPEED = 1.0
DEFAULT_AUTH_MODE = "bearer"
DEFAULT_MAX_CHARS = 3800

VALID_AUTH_MODES = ("bearer", "api-key")

# Rough estimate: tts-hd speech at speed 1.0 is ~150 words per minute and
# ~5 chars per word, so ~750 chars per minute.
CHARS_PER_MINUTE = 750

KEYCHAIN_SERVICE = "narrate-azure-openai-api-key"


def default_config_path() -> Path:
    override = os.environ.get("NARRATE_CONFIG_PATH")
    if override:
        return Path(override).expanduser()
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg).expanduser() if xdg else Path.home() / ".config"
    return base / "narrate" / "config.toml"


# ----------------------------------------------------------------------------
# Errors
# ----------------------------------------------------------------------------


class SetupError(RuntimeError):
    """Raised when the environment is not ready to synthesize."""


# ----------------------------------------------------------------------------
# Settings (resolved configuration + per-key source for diagnostics)
# ----------------------------------------------------------------------------


@dataclass
class Settings:
    endpoint: str = ""
    deployment: str = DEFAULT_DEPLOYMENT
    api_version: str = DEFAULT_API_VERSION
    voice: str = DEFAULT_VOICE
    speed: float = DEFAULT_SPEED
    auth_mode: str = DEFAULT_AUTH_MODE
    sources: dict[str, str] = field(default_factory=dict)

    def source(self, key: str) -> str:
        return self.sources.get(key, "default")


# ----------------------------------------------------------------------------
# TOML helpers (tiny escaper + flat-section writer, no third-party deps)
# ----------------------------------------------------------------------------


_TOML_ESCAPES = {
    "\\": "\\\\",
    '"': '\\"',
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\b": "\\b",
    "\f": "\\f",
}


def _toml_escape_string(s: str) -> str:
    return "".join(_TOML_ESCAPES.get(c, c) for c in s)


def _toml_value(v: object) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return f'"{_toml_escape_string(v)}"'
    raise TypeError(f"Unsupported TOML value type: {type(v).__name__}")


def write_toml_flat(sections: dict[str, dict[str, object]]) -> str:
    """Render a flat {section: {key: value}} mapping as TOML text."""
    out: list[str] = []
    for section, body in sections.items():
        if out:
            out.append("")
        out.append(f"[{section}]")
        for k, v in body.items():
            out.append(f"{k} = {_toml_value(v)}")
    out.append("")
    return "\n".join(out)


# ----------------------------------------------------------------------------
# Config file I/O
# ----------------------------------------------------------------------------


def load_config(path: Path | None = None) -> dict:
    """Read config.toml. Returns {} if missing. Raises SetupError on parse error."""
    path = path or default_config_path()
    if not path.exists():
        return {}
    if tomllib is None:
        raise SetupError(
            "Config file support requires Python 3.11+ (tomllib).\n"
            f"Found {sys.version.split()[0]}. Use env vars instead, or upgrade Python."
        )
    try:
        with path.open("rb") as f:
            return tomllib.load(f)
    except tomllib.TOMLDecodeError as exc:
        raise SetupError(
            f"Config file at {path} is not valid TOML:\n  {exc}\n"
            "Fix it by hand or re-run `synthesize_tts.py setup`."
        ) from exc


def save_config(cfg: dict, path: Path | None = None) -> Path:
    """Write config.toml atomically with 0600 perms. Returns the path written."""
    path = path or default_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = write_toml_flat(cfg)
    # Unique sibling temp file so concurrent writers can't clobber each other.
    fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    tmp = Path(tmp_name)
    old_umask = os.umask(0o077)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise
    finally:
        os.umask(old_umask)
    return path


# ----------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------


def validate_settings(s: Settings) -> None:
    if not s.endpoint:
        raise SetupError(
            "Azure OpenAI endpoint is not configured.\n"
            "Run: synthesize_tts.py setup\n"
            "Or set: export AZURE_OPENAI_ENDPOINT=https://<resource>.cognitiveservices.azure.com"
        )
    parsed = urllib.parse.urlparse(s.endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        raise SetupError(
            f"Endpoint must be an https:// URL, got: {s.endpoint!r}"
        )
    if not s.deployment:
        raise SetupError("Deployment name is empty.")
    if not s.api_version:
        raise SetupError("API version is empty.")
    if not s.voice:
        raise SetupError("Voice is empty.")
    if not isinstance(s.speed, (int, float)) or not math.isfinite(s.speed) or s.speed <= 0 or s.speed > 4:
        raise SetupError(f"Speed must be a finite positive number ≤ 4, got {s.speed!r}.")
    if s.auth_mode not in VALID_AUTH_MODES:
        raise SetupError(
            f"auth_mode must be one of {VALID_AUTH_MODES}, got {s.auth_mode!r}."
        )


# ----------------------------------------------------------------------------
# Settings resolution: CLI > env > config > defaults
# ----------------------------------------------------------------------------


def _coalesce(key: str, cli_val, env_val: str | None, cfg_val, default):
    """Return (value, source) using precedence CLI > env > config > default."""
    if cli_val is not None:
        return cli_val, f"cli (--{key.replace('_', '-')})"
    if env_val is not None and env_val != "":
        return env_val, f"env"
    if cfg_val is not None:
        return cfg_val, "config"
    return default, "default"


def _as_str(val, field: str, source: str) -> str:
    if val is None:
        return ""
    if not isinstance(val, str):
        raise SetupError(
            f"Config value for {field!r} from {source} must be a string, "
            f"got {type(val).__name__}: {val!r}"
        )
    return val


def _as_float(val, field: str, source: str) -> float:
    if val is None:
        return DEFAULT_SPEED
    if isinstance(val, bool):
        raise SetupError(f"{field!r} from {source} must be a number, got bool.")
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val)
        except ValueError as exc:
            raise SetupError(
                f"{field!r} from {source} must be a number, got {val!r}."
            ) from exc
    raise SetupError(
        f"{field!r} from {source} must be a number, got {type(val).__name__}."
    )


def resolve_settings(
    *,
    cli_voice: str | None = None,
    cli_speed: float | None = None,
    config: dict | None = None,
) -> Settings:
    """Merge CLI, env vars, and config file into a Settings object with sources."""
    cfg = (config or {}).get("azure_openai", {}) if config else {}
    s = Settings()
    s.sources = {}

    val, src = _coalesce(
        "endpoint",
        None,
        os.environ.get("AZURE_OPENAI_ENDPOINT"),
        cfg.get("endpoint"),
        "",
    )
    endpoint_str = _as_str(val, "endpoint", src)
    s.endpoint = endpoint_str.rstrip("/")
    s.sources["endpoint"] = f"{src} (AZURE_OPENAI_ENDPOINT)" if src == "env" else src

    val, src = _coalesce(
        "deployment",
        None,
        os.environ.get("NARRATE_TTS_DEPLOYMENT"),
        cfg.get("deployment"),
        DEFAULT_DEPLOYMENT,
    )
    s.deployment = _as_str(val, "deployment", src)
    s.sources["deployment"] = f"{src} (NARRATE_TTS_DEPLOYMENT)" if src == "env" else src

    val, src = _coalesce(
        "api_version",
        None,
        os.environ.get("NARRATE_TTS_API_VERSION"),
        cfg.get("api_version"),
        DEFAULT_API_VERSION,
    )
    s.api_version = _as_str(val, "api_version", src)
    s.sources["api_version"] = f"{src} (NARRATE_TTS_API_VERSION)" if src == "env" else src

    val, src = _coalesce(
        "voice",
        cli_voice,
        os.environ.get("NARRATE_TTS_VOICE"),
        cfg.get("voice"),
        DEFAULT_VOICE,
    )
    s.voice = _as_str(val, "voice", src)
    s.sources["voice"] = f"{src} (NARRATE_TTS_VOICE)" if src == "env" else src

    env_speed = os.environ.get("NARRATE_TTS_SPEED")
    parsed_env_speed: float | None = None
    if env_speed:
        try:
            parsed_env_speed = float(env_speed)
        except ValueError:
            raise SetupError(
                f"NARRATE_TTS_SPEED must be a number, got {env_speed!r}."
            )
    val, src = _coalesce(
        "speed",
        cli_speed,
        parsed_env_speed,
        cfg.get("speed"),
        DEFAULT_SPEED,
    )
    s.speed = _as_float(val, "speed", src)
    s.sources["speed"] = f"{src} (NARRATE_TTS_SPEED)" if src == "env" else src

    val, src = _coalesce(
        "auth_mode",
        None,
        os.environ.get("NARRATE_AUTH_MODE"),
        cfg.get("auth_mode"),
        DEFAULT_AUTH_MODE,
    )
    s.auth_mode = _as_str(val, "auth_mode", src)
    s.sources["auth_mode"] = f"{src} (NARRATE_AUTH_MODE)" if src == "env" else src

    return s


# ----------------------------------------------------------------------------
# Keychain (macOS) — best-effort secret storage
# ----------------------------------------------------------------------------


def endpoint_to_account(endpoint: str) -> str:
    """Normalize endpoint to a lowercase hostname for use as keychain account."""
    parsed = urllib.parse.urlparse(endpoint)
    host = (parsed.netloc or parsed.path).lower().strip()
    if not host:
        raise SetupError(f"Cannot derive hostname from endpoint: {endpoint!r}")
    return host


def keychain_available() -> bool:
    return platform.system() == "Darwin" and shutil.which("security") is not None


def keychain_get(account: str, service: str = KEYCHAIN_SERVICE) -> str | None:
    if not keychain_available():
        return None
    result = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout.rstrip("\n") or None


def keychain_set(account: str, secret: str, service: str = KEYCHAIN_SERVICE) -> None:
    """Store secret in macOS Keychain. NOTE: the secret transits via argv during
    this call, which is briefly visible to local process inspection. Prefer
    bearer auth in shared environments.
    """
    if not keychain_available():
        raise SetupError(
            "macOS Keychain (`security` CLI) not available on this platform.\n"
            "Set the key via env var instead:\n"
            "  export NARRATE_AZURE_OPENAI_API_KEY=<key>"
        )
    result = subprocess.run(
        [
            "security", "add-generic-password",
            "-s", service,
            "-a", account,
            "-w", secret,
            "-U",  # update if exists
        ],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise SetupError(
            f"`security add-generic-password` failed: {result.stderr.strip() or '(no stderr)'}"
        )


# ----------------------------------------------------------------------------
# API key resolution (api-key auth mode only)
# ----------------------------------------------------------------------------


def get_api_key(endpoint: str) -> tuple[str | None, str]:
    """Return (key, source) where source is 'env', 'keychain', or 'missing'."""
    env_key = os.environ.get("NARRATE_AZURE_OPENAI_API_KEY", "").strip()
    if env_key:
        return env_key, "env"
    if keychain_available():
        try:
            account = endpoint_to_account(endpoint)
        except SetupError:
            return None, "missing"
        kc = keychain_get(account)
        if kc:
            return kc, "keychain"
    return None, "missing"


# ----------------------------------------------------------------------------
# Pre-flight
# ----------------------------------------------------------------------------


def preflight_external_tools(auth_mode: str) -> None:
    if auth_mode == "bearer" and not shutil.which("az"):
        raise SetupError(
            "`az` (Azure CLI) is required for bearer-token auth but is not on PATH.\n"
            "Install: https://learn.microsoft.com/cli/azure/install-azure-cli\n"
            "Or switch auth_mode to 'api-key' (run `synthesize_tts.py setup`)."
        )
    if not shutil.which("ffmpeg"):
        raise SetupError(
            "`ffmpeg` is required to concatenate audio chunks but is not on PATH.\n"
            "macOS: brew install ffmpeg"
        )


# ----------------------------------------------------------------------------
# Output-path safety
# ----------------------------------------------------------------------------


def is_inside_tracked_git_worktree(path: Path) -> bool:
    """True if `path` resolves inside a git worktree (tracked or not).

    Resolves the nearest existing ancestor so that an output path with a
    not-yet-created parent (e.g. ``repo/new-dir/audio.mp3``) is still
    correctly classified.
    """
    probe = path.resolve()
    if not probe.exists():
        for parent in probe.parents:
            if parent.exists():
                probe = parent
                break
    elif probe.is_file():
        probe = probe.parent
    try:
        result = subprocess.run(
            ["git", "-C", str(probe),
             "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.returncode == 0 and result.stdout.strip() == "true"
    except FileNotFoundError:
        return False


def assert_output_safe(output: Path, force: bool, allow_tracked: bool) -> None:
    """Refuse to clobber existing files and refuse to write into a git worktree
    unless explicitly allowed.
    """
    if output.exists() and output.stat().st_size > 0 and not force:
        raise SetupError(
            f"Refusing to overwrite existing non-empty file: {output}\n"
            "Pass --force to overwrite, or pick a different --output."
        )
    if is_inside_tracked_git_worktree(output) and not allow_tracked:
        raise SetupError(
            f"Output path is inside a git worktree: {output}\n"
            "Audio (.mp3) and transcript (.narration.md) artifacts should usually live "
            "outside tracked repos. Either:\n"
            "  - Pass --output to a path outside the repo, or\n"
            "  - Pass --allow-tracked if you really want to write here\n"
            "    (and remember to add the artifact paths to .gitignore)."
        )


# ----------------------------------------------------------------------------
# Chunking
# ----------------------------------------------------------------------------


def _split_long_paragraph(p: str, max_chars: int) -> list[str]:
    """Sentence-split a paragraph that is itself larger than max_chars.

    Falls back to hard char-split as a last resort so no chunk ever exceeds
    max_chars.
    """
    sentences = re.split(r"(?<=[.!?])\s+", p.strip())
    chunks: list[str] = []
    current = ""
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        candidate = (current + " " + s) if current else s
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            chunks.append(current)
            current = ""
        if len(s) <= max_chars:
            current = s
        else:
            for i in range(0, len(s), max_chars):
                chunks.append(s[i:i + max_chars])
            current = ""
    if current:
        chunks.append(current)
    return chunks


def chunk_script(text: str, max_chars: int = DEFAULT_MAX_CHARS) -> list[str]:
    """Paragraph-aware chunker that never produces a chunk > max_chars."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""
    for p in paragraphs:
        candidate = (current + "\n\n" + p) if current else p
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            chunks.append(current)
            current = ""
        if len(p) <= max_chars:
            current = p
        else:
            for piece in _split_long_paragraph(p, max_chars):
                if current:
                    chunks.append(current)
                    current = ""
                if len(piece) <= max_chars:
                    if current:
                        chunks.append(current)
                    current = piece
                else:
                    chunks.append(piece)
                    current = ""
    if current:
        chunks.append(current)
    return chunks


def estimate_minutes(text: str) -> float:
    return max(1, len(text)) / CHARS_PER_MINUTE


# ----------------------------------------------------------------------------
# Auth (Azure OpenAI bearer)
# ----------------------------------------------------------------------------


def get_azure_bearer_token() -> str:
    result = subprocess.run(
        [
            "az", "account", "get-access-token",
            "--resource", "https://cognitiveservices.azure.com",
            "-o", "json",
        ],
        check=False, capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise SetupError(
            "`az account get-access-token` failed. Are you logged in?\n"
            f"stderr: {result.stderr.strip() or '(empty)'}\n"
            "Try: az login"
        )
    return json.loads(result.stdout)["accessToken"]


# ----------------------------------------------------------------------------
# Backend: Azure OpenAI tts-hd
# ----------------------------------------------------------------------------


def synthesize_azure_openai(
    chunk: str,
    out_path: Path,
    *,
    voice: str,
    speed: float,
    endpoint: str,
    deployment: str,
    api_version: str,
    auth_mode: str,
    token_provider=None,
    api_key: str | None = None,
) -> None:
    """Synthesize one chunk via Azure OpenAI tts-hd; write bytes to out_path.

    Retries on 429/5xx with exponential backoff. For bearer auth, refreshes the
    token on 401/403 once and re-tries. For api-key auth, 401/403 is terminal.
    """
    try:
        import requests  # lazy import: --dry-run does not need it
    except ImportError as exc:
        raise SetupError(
            "Python package `requests` is required for the azure-openai backend.\n"
            "Install: pip install requests"
        ) from exc

    if auth_mode not in VALID_AUTH_MODES:
        raise SetupError(f"Invalid auth_mode: {auth_mode!r}")
    if auth_mode == "bearer" and token_provider is None:
        raise SetupError("bearer auth requires a token_provider.")
    if auth_mode == "api-key" and not api_key:
        raise SetupError("api-key auth requires a non-empty api_key.")

    url = (
        f"{endpoint}/openai/deployments/{deployment}/audio/speech"
        f"?api-version={api_version}"
    )
    payload = {
        "model": deployment,
        "input": chunk,
        "voice": voice,
        "speed": speed,
        "response_format": "mp3",
    }

    def build_headers() -> dict[str, str]:
        if auth_mode == "bearer":
            token = token_provider()
            return {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
        assert api_key is not None  # validated above
        return {
            "api-key": api_key,
            "Content-Type": "application/json",
        }

    backoff = 2.0
    last_auth_error: str | None = None
    for attempt in range(1, 4):
        headers = build_headers()
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=180)
        except requests.RequestException as exc:
            if attempt == 3:
                raise SetupError(f"TTS request failed: {exc}") from exc
            time.sleep(backoff)
            backoff *= 2
            continue

        if r.status_code == 200:
            if not r.content:
                raise SetupError(
                    "TTS call returned HTTP 200 with empty body — refusing to "
                    "write a zero-byte audio chunk. Check the deployment, "
                    "voice, and input length."
                )
            out_path.write_bytes(r.content)
            if out_path.stat().st_size == 0:
                raise SetupError(
                    f"TTS chunk written to {out_path} is zero bytes."
                )
            return
        if r.status_code in (401, 403):
            last_auth_error = f"HTTP {r.status_code}: {r.text[:300]}"
            if auth_mode == "bearer":
                token_provider(force_refresh=True)
                if attempt == 3:
                    raise SetupError(
                        "TTS auth failed after token refresh attempts.\n"
                        f"Last response: {last_auth_error}\n"
                        "Verify `az login` is current and your account has access "
                        "to the deployment."
                    )
                continue
            raise SetupError(
                "TTS auth failed (api-key mode).\n"
                f"Response: {last_auth_error}\n"
                "Verify the key with `synthesize_tts.py setup` or update the "
                "key in macOS Keychain / NARRATE_AZURE_OPENAI_API_KEY."
            )
        if r.status_code == 429 or 500 <= r.status_code < 600:
            if attempt == 3:
                raise SetupError(
                    f"TTS call failed after retries: HTTP {r.status_code}\n"
                    f"{r.text[:500]}"
                )
            time.sleep(backoff)
            backoff *= 2
            continue
        raise SetupError(
            f"TTS call failed: HTTP {r.status_code}\n{r.text[:500]}"
        )
    # Defensive: should be unreachable because every branch above either
    # returns or raises on attempt==3.
    raise SetupError(
        "TTS call exhausted retries without a definitive response — "
        "this should not happen; please report."
    )


BACKENDS = {
    "azure-openai": synthesize_azure_openai,
}


# ----------------------------------------------------------------------------
# ffmpeg concat
# ----------------------------------------------------------------------------


def concat_mp3s(parts: list[Path], output: Path) -> None:
    """Concatenate mp3 parts into output via ffmpeg, atomically.

    Refuses any zero-byte part. Writes to a temp sibling and renames only on
    success so a failing ffmpeg run cannot leave a partial file.
    """
    for p in parts:
        if not p.exists() or p.stat().st_size == 0:
            raise SetupError(f"Refusing to concat: chunk missing or empty: {p}")
    tmp_output = output.with_suffix(output.suffix + ".tmp")
    if len(parts) == 1:
        tmp_output.write_bytes(parts[0].read_bytes())
        if tmp_output.stat().st_size == 0:
            tmp_output.unlink(missing_ok=True)
            raise SetupError("Single-chunk copy produced a zero-byte output.")
        os.replace(tmp_output, output)
        return
    with tempfile.NamedTemporaryFile(
        "w", suffix=".txt", delete=False, encoding="utf-8"
    ) as listfile:
        for p in parts:
            escaped = str(p.as_posix()).replace("'", "'\\''")
            listfile.write(f"file '{escaped}'\n")
        list_path = listfile.name
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-f", "concat", "-safe", "0",
                "-i", list_path,
                "-c", "copy",
                # Force the mp3 muxer: the temp sibling ends in ".mp3.tmp", and
                # ffmpeg cannot infer an output format from the ".tmp" extension
                # (it fails with "Unable to find a suitable output format").
                "-f", "mp3",
                str(tmp_output),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            tmp_output.unlink(missing_ok=True)
            raise SetupError(
                "ffmpeg concat failed.\n"
                f"stderr: {result.stderr.strip() or '(empty)'}"
            )
        if not tmp_output.exists() or tmp_output.stat().st_size == 0:
            tmp_output.unlink(missing_ok=True)
            raise SetupError("ffmpeg produced a zero-byte output.")
        os.replace(tmp_output, output)
    finally:
        try:
            os.unlink(list_path)
        except OSError:
            pass


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------


def _positive_int(s: str) -> int:
    try:
        v = int(s)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"--max-chars must be a positive integer, got {s!r}"
        ) from exc
    if v <= 0:
        raise argparse.ArgumentTypeError(
            f"--max-chars must be a positive integer, got {v}"
        )
    return v


def parse_synth_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="synthesize_tts.py",
        description="Synthesize a narration script (.md) into an .mp3.",
        epilog="Run `synthesize_tts.py setup` for first-time configuration.",
    )
    p.add_argument("script", type=Path, help="Path to narration script (.md)")
    p.add_argument("output", nargs="?", type=Path, default=None,
                   help="Path to output .mp3 (or use --output)")
    p.add_argument("-o", "--output", dest="output_flag", type=Path, default=None,
                   help="Path to output .mp3 (overrides positional output)")
    p.add_argument("--config", type=Path, default=None,
                   help=f"Config file path (default: {default_config_path()})")
    p.add_argument("--backend", default="azure-openai", choices=sorted(BACKENDS),
                   help="TTS backend (default: azure-openai)")
    # NOTE: voice/speed default to None so we can detect whether the user
    # passed them explicitly. Resolution happens in resolve_settings().
    p.add_argument("--voice", default=None,
                   help=f"Voice name (default: from config/env or {DEFAULT_VOICE})")
    p.add_argument("--speed", type=float, default=None,
                   help=f"Speech speed (default: from config/env or {DEFAULT_SPEED})")
    p.add_argument("--max-chars", type=_positive_int, default=DEFAULT_MAX_CHARS,
                   help=f"Max chars per TTS chunk (default: {DEFAULT_MAX_CHARS})")
    p.add_argument("--force", action="store_true",
                   help="Overwrite existing output file")
    p.add_argument("--allow-tracked", action="store_true",
                   help="Allow writing into a git worktree")
    p.add_argument("--dry-run", action="store_true",
                   help="Plan only: chunk, validate config, no network calls")
    args = p.parse_args(argv)
    if args.output_flag is not None:
        args.output = args.output_flag
    if args.output is None:
        p.error("output path is required (positional or --output)")
    return args


def parse_setup_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="synthesize_tts.py setup",
        description="Interactive first-time configuration for the narrate skill.",
    )
    p.add_argument("--config", type=Path, default=None,
                   help=f"Config file path (default: {default_config_path()})")
    p.add_argument("--non-interactive", action="store_true",
                   help="Fail rather than prompt; useful for scripted bootstrap")
    return p.parse_args(argv)


def parse_config_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="synthesize_tts.py config",
        description="Inspect or modify the narrate config.",
    )
    sub = p.add_subparsers(dest="action", required=True)
    show = sub.add_parser("show", help="Print resolved config and per-key source")
    show.add_argument("--config", type=Path, default=None,
                      help=f"Config file path (default: {default_config_path()})")
    path = sub.add_parser("path", help="Print the resolved config file path")
    path.add_argument("--config", type=Path, default=None)
    return p.parse_args(argv)


# ----------------------------------------------------------------------------
# Subcommand handlers
# ----------------------------------------------------------------------------


def _prompt(label: str, current: str, source: str, *, non_interactive: bool) -> str:
    """Prompt with a [source] hint and current value as default."""
    if non_interactive:
        if not current:
            raise SetupError(f"{label} is required (non-interactive mode).")
        return current
    src_hint = f"[{source}]" if current else "[required]"
    suffix = f" {src_hint} (default: {current})" if current else f" {src_hint}"
    val = input(f"{label}{suffix}: ").strip()
    return val or current


def cmd_setup(args: argparse.Namespace) -> int:
    config_path = (args.config or default_config_path()).expanduser()
    print(f"narrate setup — writing config to: {config_path}")
    print()

    # Pre-populate from env > existing config > defaults so the user can
    # confirm or override.
    try:
        existing = load_config(config_path)
    except SetupError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2
    seed = resolve_settings(config=existing)

    endpoint = _prompt(
        "Azure OpenAI endpoint (https://<resource>.cognitiveservices.azure.com)",
        seed.endpoint, seed.source("endpoint"),
        non_interactive=args.non_interactive,
    )
    if endpoint and not endpoint.startswith("https://"):
        sys.stderr.write(f"Endpoint must start with https:// — got {endpoint!r}\n")
        return 2
    endpoint = endpoint.rstrip("/") if endpoint else ""

    deployment = _prompt(
        "Deployment name",
        seed.deployment, seed.source("deployment"),
        non_interactive=args.non_interactive,
    )
    api_version = _prompt(
        "API version",
        seed.api_version, seed.source("api_version"),
        non_interactive=args.non_interactive,
    )
    voice = _prompt(
        "Voice",
        seed.voice, seed.source("voice"),
        non_interactive=args.non_interactive,
    )
    speed_raw = _prompt(
        "Speed",
        str(seed.speed), seed.source("speed"),
        non_interactive=args.non_interactive,
    )
    try:
        speed = float(speed_raw)
    except ValueError:
        sys.stderr.write(f"Speed must be a number, got {speed_raw!r}\n")
        return 2

    auth_mode = _prompt(
        f"Auth mode ({'/'.join(VALID_AUTH_MODES)})",
        seed.auth_mode, seed.source("auth_mode"),
        non_interactive=args.non_interactive,
    )
    if auth_mode not in VALID_AUTH_MODES:
        sys.stderr.write(
            f"auth_mode must be one of {VALID_AUTH_MODES}, got {auth_mode!r}\n"
        )
        return 2

    # Build the final settings to validate before writing.
    final = Settings(
        endpoint=endpoint, deployment=deployment, api_version=api_version,
        voice=voice, speed=speed, auth_mode=auth_mode,
    )
    try:
        validate_settings(final)
    except SetupError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2

    # Confirm overwrite BEFORE any side effects (Keychain write).
    if config_path.exists() and not args.non_interactive:
        ans = input(f"\nOverwrite existing {config_path}? [y/N]: ").strip().lower()
        if ans not in ("y", "yes"):
            print("Aborted; config not written, no secrets stored.")
            return 1

    # Optional: store API key if auth_mode is api-key. Done AFTER overwrite
    # confirmation so a declined overwrite never modifies the Keychain.
    if auth_mode == "api-key":
        if args.non_interactive:
            print(
                "[setup] api-key mode selected. Make sure "
                "NARRATE_AZURE_OPENAI_API_KEY is exported or the key is in "
                "macOS Keychain.",
                file=sys.stderr,
            )
        else:
            print()
            print("api-key auth selected. We can store the key in macOS Keychain,")
            print("or you can skip and set NARRATE_AZURE_OPENAI_API_KEY yourself.")
            store = input("Store key in macOS Keychain now? [y/N]: ").strip().lower()
            if store in ("y", "yes"):
                if not keychain_available():
                    sys.stderr.write(
                        "macOS Keychain not available. Export "
                        "NARRATE_AZURE_OPENAI_API_KEY instead.\n"
                    )
                    return 2
                # getpass keeps the key out of terminal history / scrollback.
                # NOTE: the key still transits via argv to `security add-generic-password`
                # which is briefly visible to local process inspection.
                key = getpass.getpass("Azure OpenAI API key (input hidden): ").strip()
                if not key:
                    sys.stderr.write("Empty key — aborting.\n")
                    return 2
                try:
                    account = endpoint_to_account(endpoint)
                    keychain_set(account, key)
                except SetupError as exc:
                    sys.stderr.write(f"{exc}\n")
                    return 2
                print(f"  ✓ stored key in Keychain (service={KEYCHAIN_SERVICE}, account={account})")

    written = save_config(
        {"azure_openai": {
            "endpoint": endpoint,
            "deployment": deployment,
            "api_version": api_version,
            "voice": voice,
            "speed": speed,
            "auth_mode": auth_mode,
        }},
        config_path,
    )
    print(f"\n✓ wrote {written}")
    print("Run `synthesize_tts.py config show` to verify, or kick off a synth.")
    return 0


def cmd_config(args: argparse.Namespace) -> int:
    config_path = (args.config or default_config_path()).expanduser()
    if args.action == "path":
        print(config_path)
        return 0
    # action == "show"
    try:
        cfg = load_config(config_path)
        s = resolve_settings(config=cfg)
    except SetupError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2
    print(f"config file: {config_path}  ({'exists' if config_path.exists() else 'missing'})")
    print()
    print(f"endpoint    : {s.endpoint or '(unset)'}  [{s.source('endpoint')}]")
    print(f"deployment  : {s.deployment}  [{s.source('deployment')}]")
    print(f"api_version : {s.api_version}  [{s.source('api_version')}]")
    print(f"voice       : {s.voice}  [{s.source('voice')}]")
    print(f"speed       : {s.speed}  [{s.source('speed')}]")
    print(f"auth_mode   : {s.auth_mode}  [{s.source('auth_mode')}]")
    if s.auth_mode == "api-key" and s.endpoint:
        _, key_src = get_api_key(s.endpoint)
        print(f"api_key     : {'present' if key_src != 'missing' else 'MISSING'}  [{key_src}]")
    # Tool availability
    print()
    print(f"az          : {'found' if shutil.which('az') else 'MISSING'}")
    print(f"ffmpeg      : {'found' if shutil.which('ffmpeg') else 'MISSING'}")
    return 0


def cmd_dry_run(args: argparse.Namespace, settings: Settings) -> int:
    if not args.script.exists():
        sys.stderr.write(f"Script not found: {args.script}\n")
        return 2
    text = args.script.read_text(encoding="utf-8")
    if not text.strip():
        sys.stderr.write(f"Script is empty: {args.script}\n")
        return 2

    chunks = chunk_script(text, args.max_chars)
    print(f"[dry-run] script: {args.script}  ({len(text):,} chars)")
    print(f"[dry-run] output: {args.output}")
    print(f"[dry-run] backend: {args.backend}")
    print(f"[dry-run] voice: {settings.voice}  speed: {settings.speed}")
    print(f"[dry-run] chunks: {len(chunks)} (max {args.max_chars} chars each)")
    for i, c in enumerate(chunks, 1):
        print(f"  chunk {i}: {len(c):,} chars")
    print(f"[dry-run] estimated duration: ~{estimate_minutes(text):.1f} min")
    print("[dry-run] resolved config:")
    print(f"  endpoint    : {settings.endpoint or 'MISSING'}  [{settings.source('endpoint')}]")
    print(f"  deployment  : {settings.deployment}  [{settings.source('deployment')}]")
    print(f"  api_version : {settings.api_version}  [{settings.source('api_version')}]")
    print(f"  auth_mode   : {settings.auth_mode}  [{settings.source('auth_mode')}]")
    if settings.auth_mode == "api-key" and settings.endpoint:
        _, key_src = get_api_key(settings.endpoint)
        print(f"  api_key     : {'present' if key_src != 'missing' else 'MISSING'}  [{key_src}]")
    print(f"  az          : {'found' if shutil.which('az') else 'MISSING'}")
    print(f"  ffmpeg      : {'found' if shutil.which('ffmpeg') else 'MISSING'}")
    if not settings.endpoint:
        sys.stdout.flush()
        sys.stderr.write(
            "[dry-run] ERROR: Azure OpenAI endpoint is not configured (MISSING "
            "above) — the most common synth blocker.\n"
            "          Resolve it before synthesizing: run "
            "`synthesize_tts.py setup`, or set "
            "AZURE_OPENAI_ENDPOINT=https://<resource>.cognitiveservices.azure.com\n"
            "          (an Azure AI Foundry "
            "https://<resource>.services.ai.azure.com endpoint also works).\n"
        )
        return 1
    over = [i for i, c in enumerate(chunks, 1) if len(c) > args.max_chars]
    if over:
        sys.stderr.write(
            f"[dry-run] ERROR: chunks exceeding max_chars: {over}\n"
        )
        return 1
    if is_inside_tracked_git_worktree(args.output) and not args.allow_tracked:
        print(
            "[dry-run] WARN: output is inside a git worktree; would refuse without "
            "--allow-tracked"
        )
    return 0


def cmd_synth(args: argparse.Namespace) -> int:
    try:
        cfg = load_config(args.config) if args.config else load_config()
        settings = resolve_settings(
            cli_voice=args.voice,
            cli_speed=args.speed,
            config=cfg,
        )
    except SetupError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2

    if args.dry_run:
        return cmd_dry_run(args, settings)

    try:
        validate_settings(settings)
        preflight_external_tools(settings.auth_mode)
    except SetupError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2

    if not args.script.exists():
        sys.stderr.write(f"Script not found: {args.script}\n")
        return 2
    text = args.script.read_text(encoding="utf-8")
    if not text.strip():
        sys.stderr.write(f"Script is empty: {args.script}\n")
        return 2

    try:
        assert_output_safe(args.output, args.force, args.allow_tracked)
    except SetupError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2

    # Fail-fast on auth setup BEFORE chunking so missing keys / az login
    # don't surface mid-progress.
    synth_kwargs: dict = dict(
        voice=settings.voice,
        speed=settings.speed,
        endpoint=settings.endpoint,
        deployment=settings.deployment,
        api_version=settings.api_version,
        auth_mode=settings.auth_mode,
    )

    if settings.auth_mode == "bearer":
        cached: dict[str, str] = {}

        def token_provider(force_refresh: bool = False) -> str:
            if force_refresh or "token" not in cached:
                cached["token"] = get_azure_bearer_token()
            return cached["token"]

        try:
            token_provider()
        except SetupError as exc:
            sys.stderr.write(f"{exc}\n")
            return 2
        print(f"[{args.script.name}] got Azure AD bearer token.")
        synth_kwargs["token_provider"] = token_provider
    else:  # api-key
        key, source = get_api_key(settings.endpoint)
        if not key:
            sys.stderr.write(
                "auth_mode is api-key, but no API key was found.\n"
                "Looked in: NARRATE_AZURE_OPENAI_API_KEY env var, "
                f"and macOS Keychain (service={KEYCHAIN_SERVICE}).\n"
                "Run `synthesize_tts.py setup` to store one, or "
                "switch auth_mode to 'bearer'.\n"
            )
            return 2
        print(f"[{args.script.name}] using api-key auth (source: {source}).")
        synth_kwargs["api_key"] = key

    args.output.parent.mkdir(parents=True, exist_ok=True)

    chunks = chunk_script(text, args.max_chars)
    print(f"[{args.script.name}] {len(text):,} chars -> {len(chunks)} chunk(s)")
    for i, c in enumerate(chunks, 1):
        print(f"  chunk {i}: {len(c):,} chars")

    synth = BACKENDS[args.backend]
    part_paths: list[Path] = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for i, chunk in enumerate(chunks, 1):
            part = tmp_dir / f"part-{i:02d}.mp3"
            print(f"[{args.script.name}] synthesizing chunk {i}/{len(chunks)}...")
            try:
                synth(chunk, part, **synth_kwargs)
            except SetupError as exc:
                sys.stderr.write(f"{exc}\n")
                return 1
            print(f"  -> {part.stat().st_size:,} bytes")
            part_paths.append(part)
        concat_mp3s(part_paths, args.output)

    size = args.output.stat().st_size
    print(f"\n[{args.script.name}] wrote {args.output} ({size:,} bytes)")
    return 0


# ----------------------------------------------------------------------------
# Entry point: subcommand pre-dispatch
# ----------------------------------------------------------------------------


SUBCOMMANDS = {"setup", "config"}


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])
    if argv and argv[0] in SUBCOMMANDS:
        cmd = argv[0]
        rest = argv[1:]
        try:
            if cmd == "setup":
                return cmd_setup(parse_setup_args(rest))
            if cmd == "config":
                return cmd_config(parse_config_args(rest))
        except SetupError as exc:
            sys.stderr.write(f"{exc}\n")
            return 2
    return cmd_synth(parse_synth_args(argv))


if __name__ == "__main__":
    sys.exit(main())
