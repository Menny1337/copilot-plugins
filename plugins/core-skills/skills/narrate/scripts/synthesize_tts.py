#!/usr/bin/env python3
"""Synthesize a narration script (.md) into spoken audio (.mp3).

Default backend: Azure OpenAI tts-hd (the proven path).
Backend seam: a `BACKENDS` dict mapping name -> synth function.

Subcommands:
  synthesize_tts.py setup                          # manual or Azure discovery config
  synthesize_tts.py config show                    # redacted config + sources
  synthesize_tts.py output-path <source.md>         # plan transcript/audio paths as JSON
  synthesize_tts.py doctor                         # explicit readiness, no speech call
  synthesize_tts.py <script.md> [output.mp3] [opts]  # synthesize (default)
  synthesize_tts.py --dry-run <script.md>           # offline checks only

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
  NARRATE_TTS_MODEL            "tts" | "tts-hd" (default: "tts-hd"; not alias)
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
import hashlib
import importlib.util
import json
import math
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
from dataclasses import dataclass, field
from contextlib import contextmanager
from email.utils import parsedate_to_datetime
from pathlib import Path

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None  # type: ignore

# Offline preflight detects requests without importing it or acquiring credentials.

# ----------------------------------------------------------------------------
# Defaults
# ----------------------------------------------------------------------------

DEFAULT_DEPLOYMENT = "tts-hd"
DEFAULT_MODEL = "tts-hd"
DEFAULT_API_VERSION = "2025-03-01-preview"
DEFAULT_VOICE = "nova"
DEFAULT_SPEED = 1.0
DEFAULT_AUTH_MODE = "bearer"
DEFAULT_MAX_CHARS = 3800

VALID_AUTH_MODES = ("bearer", "api-key")
VALID_MODELS = ("tts", "tts-hd")
VALID_VOICES = ("alloy", "echo", "fable", "onyx", "nova", "shimmer")
PRESETS = {
    "neutral": ("nova", 1.0),
    "calm": ("shimmer", 0.9),
    "conversational": ("nova", 1.05),
}

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
    model: str = DEFAULT_MODEL
    api_version: str = DEFAULT_API_VERSION
    voice: str = DEFAULT_VOICE
    speed: float = DEFAULT_SPEED
    auth_mode: str = DEFAULT_AUTH_MODE
    subscription: str = ""
    resource_group: str = ""
    account: str = ""
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


def save_config(cfg: dict, path: Path | None = None, *, overwrite: bool = True) -> Path:
    """Write config.toml atomically with 0600 perms. Returns the path written."""
    path = path or default_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = write_toml_flat(cfg)
    # Unique sibling temp file so concurrent writers can't clobber each other.
    fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, 0o600)
        publish_file(tmp, path, overwrite)
    finally:
        tmp.unlink(missing_ok=True)
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
    if (parsed.scheme != "https" or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ("", "/")
            or any(c.isspace() for c in s.endpoint)):
        raise SetupError(
            "Endpoint must be an HTTPS resource origin without credentials, "
            "a path, query, fragment, or whitespace."
        )
    try:
        parsed.port
    except ValueError as exc:
        raise SetupError("Endpoint has an invalid port.") from exc
    if not s.deployment:
        raise SetupError("Deployment name is empty.")
    if not s.api_version:
        raise SetupError("API version is empty.")
    if any(ord(c) < 32 for c in s.deployment + s.api_version):
        raise SetupError("Deployment and API version must not contain control characters.")
    if s.model not in VALID_MODELS:
        raise SetupError(
            f"Unsupported model {s.model!r}. Only tts and tts-hd are supported; "
            "use --model for model identity and --deployment for its alias. "
            "Realtime and other models require a different engine; no fallback is used."
        )
    if s.voice not in VALID_VOICES:
        raise SetupError(f"Voice must be one of {VALID_VOICES}, got {s.voice!r}.")
    if (isinstance(s.speed, bool) or not isinstance(s.speed, (int, float))
            or not math.isfinite(s.speed) or not 0.25 <= s.speed <= 4):
        raise SetupError(f"Speed must be finite and between 0.25 and 4, got {s.speed!r}.")
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
    cli: argparse.Namespace | None = None,
) -> Settings:
    """Merge CLI, env vars, and config file into a Settings object with sources."""
    cfg = (config or {}).get("azure_openai", {}) if config else {}
    if not isinstance(cfg, dict):
        raise SetupError("Config [azure_openai] must be a table.")
    s = Settings()
    env_names = {
        "endpoint": "AZURE_OPENAI_ENDPOINT", "deployment": "NARRATE_TTS_DEPLOYMENT",
        "model": "NARRATE_TTS_MODEL", "api_version": "NARRATE_TTS_API_VERSION",
        "voice": "NARRATE_TTS_VOICE", "speed": "NARRATE_TTS_SPEED",
        "auth_mode": "NARRATE_AUTH_MODE", "subscription": "NARRATE_AZURE_SUBSCRIPTION",
        "resource_group": "NARRATE_AZURE_RESOURCE_GROUP", "account": "NARRATE_AZURE_ACCOUNT",
    }
    preset = getattr(cli, "preset", None)
    for key, env_name in env_names.items():
        cli_value = getattr(cli, key, None)
        if key == "voice" and cli_voice is not None:
            cli_value = cli_voice
        if key == "speed" and cli_speed is not None:
            cli_value = cli_speed
        preset_used = preset and key in ("voice", "speed") and cli_value is None
        if preset_used:
            cli_value = PRESETS[preset][0 if key == "voice" else 1]
        val, src = _coalesce(key, cli_value, os.environ.get(env_name),
                             cfg.get(key), getattr(s, key))
        val = _as_float(val, key, src) if key == "speed" else _as_str(val, key, src)
        setattr(s, key, val.rstrip("/") if key == "endpoint" else val)
        s.sources[key] = ("cli (--preset)" if preset_used else
                          f"env ({env_name})" if src == "env" else src)
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


def check_ffmpeg_capabilities() -> None:
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-bsfs"],
        capture_output=True, text=True, check=False, timeout=30,
    )
    if result.returncode:
        raise SetupError(f"Cannot inspect ffmpeg capabilities: {result.stderr.strip()}")
    if "setts" not in result.stdout.split():
        raise SetupError(
            "This ffmpeg build lacks the `setts` bitstream filter required for "
            "MP3 concatenation. Upgrade ffmpeg before synthesizing."
        )


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
    if not shutil.which("ffprobe"):
        raise SetupError("`ffprobe` is required to verify audio duration; install ffmpeg.")
    if importlib.util.find_spec("requests") is None:
        raise SetupError("Python package `requests` is required; install it in this Python environment.")
    check_ffmpeg_capabilities()


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
    if any((parent / ".git").exists() for parent in (probe, *probe.parents)):
        return True
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


def assert_output_safe(output: Path, force: bool, allow_tracked: bool,
                       source: Path | None = None, *, audio: bool = True) -> None:
    """Refuse to clobber existing files and refuse to write into a git worktree
    unless explicitly allowed.
    """
    if audio and output.suffix.lower() != ".mp3":
        raise SetupError(f"Audio output must have an .mp3 extension: {output}")
    if source is not None and (
            output.resolve() == source.resolve()
            or (output.exists() and source.exists() and output.samefile(source))):
        raise SetupError("Output must never replace the source script, even with --force.")
    if output.is_symlink() or (output.exists() and not output.is_file()):
        raise SetupError(f"Output must be a regular file, not a symlink or directory: {output}")
    ancestor = next((p for p in output.parents if p.exists()), None)
    if ancestor is None or not ancestor.is_dir() or not os.access(ancestor, os.W_OK | os.X_OK):
        raise SetupError(f"Output parent is not a writable directory: {output.parent}")
    if output.exists() and not force:
        raise SetupError(
            f"Refusing to overwrite existing file: {output}\n"
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


def estimate_minutes(text: str, speed: float = DEFAULT_SPEED) -> float:
    return len(text.split()) / (150 * speed)


# ----------------------------------------------------------------------------
# Auth (Azure OpenAI bearer)
# ----------------------------------------------------------------------------


def get_azure_bearer_token(subscription: str = "") -> str:
    result = subprocess.run(
        [
            "az", "account", "get-access-token",
            "--resource", "https://cognitiveservices.azure.com",
            *(["--subscription", subscription] if subscription else []),
            "-o", "json",
        ],
        check=False, capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise SetupError(
            "`az account get-access-token` failed. Are you logged in?\n"
            f"stderr: {result.stderr.strip() or '(empty)'}\n"
            "Try: az login"
        )
    try:
        token = json.loads(result.stdout)["accessToken"]
    except (ValueError, KeyError, TypeError) as exc:
        raise SetupError("Azure CLI returned no usable access token; run az login.") from exc
    if not isinstance(token, str) or not token.strip():
        raise SetupError("Azure CLI returned an empty access token; run az login.")
    return token


# ----------------------------------------------------------------------------
# Backend: Azure OpenAI tts-hd
# ----------------------------------------------------------------------------


def retry_delay(value: str | None, fallback: float) -> float:
    """Honor delta seconds or HTTP dates without unbounded sleeps."""
    if value:
        try:
            delay = float(value)
        except ValueError:
            try:
                delay = parsedate_to_datetime(value).timestamp() - time.time()
            except (ValueError, TypeError, OverflowError):
                return fallback
        if math.isfinite(delay):
            return min(60.0, max(0.0, delay))
    return fallback


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
    model: str = DEFAULT_MODEL,
    token_provider=None,
    api_key: str | None = None,
) -> None:
    """Synthesize one chunk via Azure OpenAI tts-hd; write bytes to out_path.

    Retries on 429/5xx with exponential backoff. For bearer auth, refreshes the
    token on 401/403 once and re-tries. For api-key auth, 401/403 is terminal.
    """
    try:
        import requests
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
        f"{endpoint}/openai/deployments/{urllib.parse.quote(deployment, safe='')}/audio/speech"
        f"?{urllib.parse.urlencode({'api-version': api_version})}"
    )
    payload = {
        "model": model,
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
                raise SetupError("TTS request failed after retries; check connectivity and endpoint.") from exc
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
            last_auth_error = f"HTTP {r.status_code}"
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
                    f"TTS call failed after retries: HTTP {r.status_code}. "
                    "Check deployment availability and quota."
                )
            time.sleep(retry_delay(r.headers.get("Retry-After"), backoff))
            backoff *= 2
            continue
        raise SetupError(
            f"TTS call failed: HTTP {r.status_code}. Check endpoint, deployment, "
            "API version, and supported voice/model settings."
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


def verify_audio(path: Path, max_duration: float | None = None) -> float:
    """Probe duration and fully decode before accepting or publishing audio."""
    if not path.is_file() or path.stat().st_size == 0:
        raise SetupError(f"Audio is missing or empty: {path}")
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)], capture_output=True, text=True, check=False,
        timeout=180,
    )
    if result.returncode or result.stderr.strip():
        raise SetupError(f"ffprobe could not verify audio: {result.stderr.strip()}")
    try:
        duration = float(json.loads(result.stdout)["format"]["duration"])
    except (ValueError, KeyError, TypeError) as exc:
        raise SetupError("ffprobe returned no valid audio duration.") from exc
    if not math.isfinite(duration) or duration <= 0:
        raise SetupError("Audio duration must be finite and positive.")
    decoded = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path),
         "-map", "0:a:0", "-f", "null", "-"],
        capture_output=True, text=True, check=False, timeout=180,
    )
    if decoded.returncode or decoded.stderr.strip():
        raise SetupError(f"Audio decoding failed: {decoded.stderr.strip()}")
    if max_duration is not None and duration > max_duration:
        raise SetupError(
            f"Actual duration {duration:.2f}s exceeds --max-duration {max_duration:g}s. "
            "No new final audio published. Shorten the transcript and rerun explicitly."
        )
    return duration


@contextmanager
def unique_sibling(path: Path):
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        yield temporary
    finally:
        temporary.unlink(missing_ok=True)


def publish_file(temporary: Path, output: Path, force: bool) -> None:
    """The no-force path must also reject a destination created mid-render."""
    if force:
        os.replace(temporary, output)
    else:
        try:
            os.link(temporary, output)
        except FileExistsError as exc:
            raise SetupError(f"Output appeared during rendering; refusing overwrite: {output}") from exc
        temporary.unlink()


def concat_mp3s(parts: list[Path], output: Path, *,
                max_duration: float | None = None, force: bool = False) -> float:
    """Validate a unique sibling before atomically publishing final audio."""
    for p in parts:
        if not p.exists() or p.stat().st_size == 0:
            raise SetupError(f"Refusing to concat: chunk missing or empty: {p}")
    with unique_sibling(output) as temporary:
        if len(parts) == 1:
            shutil.copyfile(parts[0], temporary)
        else:
            with tempfile.NamedTemporaryFile(mode="w+", suffix=".txt", encoding="utf-8") as listing:
                for part in parts:
                    escaped = str(part.resolve()).replace("'", "'\\''")
                    if "\n" in escaped or "\r" in escaped:
                        raise SetupError("Audio cache paths must not contain newlines.")
                    listing.write(f"file '{escaped}'\n")
                listing.flush()
                # Each MP3 carries encoder delay; rebuild monotonic packet timestamps
                # across chunk boundaries without re-encoding or changing speech speed.
                result = subprocess.run(
                    ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "concat",
                     "-safe", "0", "-i", listing.name, "-c", "copy",
                     "-bsf:a", "setts=ts=N*DURATION", "-f", "mp3",
                     str(temporary)], check=False, capture_output=True, text=True, timeout=180,
                )
                if result.returncode or result.stderr.strip():
                    raise SetupError(f"ffmpeg concat failed: {result.stderr.strip()}")
        duration = verify_audio(temporary, max_duration)
        publish_file(temporary, output, force)
    return duration


def output_paths(source: Path, output_dir: Path | None = None) -> dict[str, Path]:
    source = source.expanduser().resolve()
    stem = source.stem
    if stem.endswith(".narration"):
        stem = stem[:-len(".narration")]
    if output_dir is not None:
        directory = output_dir.expanduser().resolve()
    elif is_inside_tracked_git_worktree(source):
        base = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share")))
        digest = hashlib.sha256(os.fsencode(source)).hexdigest()[:16]
        directory = base.expanduser().resolve() / "narrate" / "outputs" / digest
    else:
        directory = source.parent
    audio = directory / f"{stem}.mp3"
    if audio.resolve() == source:
        raise SetupError("Inferred audio would replace the source; choose another --output-dir.")
    return {"source": source, "transcript": directory / f"{stem}.narration.md", "audio": audio}


def preview_text(text: str, words: int) -> str:
    """Prefer a complete sentence, falling back to the word cap for long sentences."""
    stripped = text.strip()
    tokens = list(re.finditer(r"\S+", stripped))
    if len(tokens) <= words:
        return stripped
    prefix = stripped[:tokens[words - 1].end()]
    boundaries = list(re.finditer(r"""[.!?]["')\]]*(?=\s|$)""", prefix))
    if boundaries:
        sentence_prefix = prefix[:boundaries[-1].end()]
        # A lone abbreviation such as "Dr." should not collapse a useful sample.
        if len(sentence_prefix.split()) >= words / 2:
            return sentence_prefix
    return prefix


def reject_symlinks(path: Path) -> None:
    for candidate in (path, *path.parents):
        if candidate.is_symlink():
            raise SetupError(f"Unsafe symlink in cache path: {candidate}")


def private_directory(path: Path) -> None:
    reject_symlinks(path)
    if not path.exists():
        path.mkdir(mode=0o700, parents=True)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
        raise SetupError(f"Cache directory must be private (mode 0700): {path}")
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        raise SetupError(f"Cache directory is not owned by the current user: {path}")


def safe_cache_file(path: Path) -> None:
    if path.is_symlink():
        raise SetupError(f"Unsafe symlink cache artifact: {path}")
    if path.exists():
        info = path.stat()
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077
                or (hasattr(os, "getuid") and info.st_uid != os.getuid())):
            raise SetupError(f"Unsafe cache artifact (require private regular file): {path}")


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def job_identity(text: str, settings: Settings, args: argparse.Namespace) -> str:
    identity = {
        "version": 1, "backend": args.backend, "content": digest_bytes(text.encode()),
        "chunk_text": [digest_bytes(chunk.encode()) for chunk in chunk_script(text, args.max_chars)],
        **{k: getattr(settings, k) for k in
           ("endpoint", "model", "deployment", "api_version", "voice", "speed")},
        "max_chars": args.max_chars, "preview": args.preview,
        "preview_words": args.preview_words if args.preview else None,
    }
    return digest_bytes(json.dumps(identity, sort_keys=True).encode())


class ResumeJob:
    def __init__(self, directory: Path, key: str):
        self.directory = directory
        self.key = key
        self.manifest = directory / "manifest.json"
        self.entries: dict[str, str] = {}

    def load(self) -> None:
        safe_cache_file(self.manifest)
        if self.manifest.exists():
            try:
                data = json.loads(self.manifest.read_text(encoding="utf-8"))
            except (ValueError, UnicodeError) as exc:
                raise SetupError(f"Invalid resume manifest: {self.manifest}; choose a new resume directory.") from exc
            if (not isinstance(data, dict) or data.get("version") != 1
                    or data.get("key") != self.key or not isinstance(data.get("chunks"), dict)
                    or not all(isinstance(k, str) and isinstance(v, str)
                               for k, v in data["chunks"].items())):
                raise SetupError(f"Incompatible resume manifest: {self.manifest}")
            self.entries = data["chunks"]

    def reuse(self, index: int) -> Path | None:
        part = self.directory / f"part-{index:05d}.mp3"
        safe_cache_file(part)
        expected = self.entries.get(part.name)
        if not part.exists() or not expected:
            return None
        if digest_bytes(part.read_bytes()) != expected:
            print(f"[resume] corrupt chunk {index}; synthesizing again.", file=sys.stderr)
            return None
        try:
            verify_audio(part)
        except SetupError as exc:
            print(f"[resume] invalid chunk {index}: {exc}; synthesizing again.", file=sys.stderr)
            return None
        return part

    def record(self, part: Path) -> None:
        self.entries[part.name] = digest_bytes(part.read_bytes())
        safe_cache_file(self.manifest)
        with unique_sibling(self.manifest) as temporary:
            temporary.write_text(json.dumps(
                {"version": 1, "key": self.key, "chunks": self.entries}, sort_keys=True
            ) + "\n", encoding="utf-8")
            os.replace(temporary, self.manifest)


@contextmanager
def resume_job(root: Path, key: str, protected: list[Path]):
    root = root.expanduser().absolute()
    reject_symlinks(root)
    directory = root / key
    for path in protected:
        if path.resolve().is_relative_to(root.resolve()):
            raise SetupError("Source/output/transcript must not be inside --resume-dir.")
    private_directory(root)
    private_directory(directory)
    lock = directory / ".lock"
    safe_cache_file(lock)
    try:
        fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise SetupError(
            f"Resume job is locked: {lock}. If the owning process has ended, "
            "remove only this lock file manually, then retry."
        ) from exc
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(f"{os.getpid()}\n")
        print(f"[resume] Retaining sensitive audio in {directory}. "
              "Clean up only this exact job directory manually when no longer needed.")
        job = ResumeJob(directory, key)
        job.load()
        yield job
    finally:
        lock.unlink(missing_ok=True)


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


def add_settings_args(p: argparse.ArgumentParser) -> None:
    for flag in ("endpoint", "deployment", "model", "api-version", "auth-mode",
                 "subscription", "resource-group", "account"):
        p.add_argument(f"--{flag}", default=None)
    p.add_argument("--voice", default=None, help="Supported voice (default: config/env or nova)")
    p.add_argument("--speed", type=float, default=None, help="Finite speed from 0.25 through 4")


def parse_synth_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="synthesize_tts.py",
        description="Synthesize a narration script (.md) into an .mp3.",
        epilog="Run `synthesize_tts.py setup` for first-time configuration.",
    )
    p.add_argument("script", type=Path, help="Path to narration script (.md)")
    p.add_argument("output", nargs="?", type=Path, default=None,
                   help="Optional .mp3 path; inferred beside script or in XDG data outside repos")
    p.add_argument("-o", "--output", dest="output_flag", type=Path, default=None,
                   help="Path to output .mp3 (overrides positional output)")
    p.add_argument("--config", type=Path, default=None,
                   help=f"Config file path (default: {default_config_path()})")
    p.add_argument("--backend", default="azure-openai", choices=sorted(BACKENDS),
                   help="TTS backend (default: azure-openai)")
    # NOTE: voice/speed default to None so we can detect whether the user
    # passed them explicitly. Resolution happens in resolve_settings().
    add_settings_args(p)
    p.add_argument("--preset", choices=sorted(PRESETS), help="Voice/speed preset, not model style instructions")
    p.add_argument("--preview", action="store_true", help="Render only a separate preview and exact transcript")
    p.add_argument("--preview-words", type=_positive_int, default=60, help="Preview word cap, 1..500 (default: 60)")
    p.add_argument("--resume-dir", type=Path, help="Opt in to private, retained, content-keyed audio chunks")
    p.add_argument("--max-duration", type=float, help="Hard actual-duration cap in seconds; never truncates")
    p.add_argument("--max-chars", type=_positive_int, default=DEFAULT_MAX_CHARS,
                   help=f"Max chars per TTS chunk (default: {DEFAULT_MAX_CHARS})")
    p.add_argument("--force", action="store_true",
                   help="Overwrite existing output file")
    p.add_argument("--allow-tracked", action="store_true",
                   help="Allow writing into a git worktree")
    p.add_argument("--dry-run", action="store_true",
                   help="Offline validation and estimate; no network, token, keychain, or writes")
    args = p.parse_args(argv)
    if args.output_flag is not None:
        args.output = args.output_flag
    return args


def parse_setup_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="synthesize_tts.py setup",
        description="Manual setup or read-only Azure account/deployment discovery.",
    )
    p.add_argument("--config", type=Path, default=None,
                   help=f"Config file path (default: {default_config_path()})")
    p.add_argument("--non-interactive", action="store_true",
                   help="Fail rather than prompt; useful for scripted bootstrap")
    p.add_argument("--force", action="store_true", help="Approve replacing existing config")
    add_settings_args(p)
    return p.parse_args(argv)


def parse_doctor_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="synthesize_tts.py doctor",
        description="Explicit auth/deployment readiness checks; no synthesis or speech GET.",
    )
    p.add_argument("--config", type=Path)
    add_settings_args(p)
    return p.parse_args(argv)


def cmd_output_path(argv: list[str]) -> int:
    p = argparse.ArgumentParser(
        prog="synthesize_tts.py output-path",
        description="Print source/transcript/audio paths as JSON without creating files.",
    )
    p.add_argument("source", type=Path)
    p.add_argument("--output-dir", type=Path)
    args = p.parse_args(argv)
    print(json.dumps({k: str(v) for k, v in output_paths(args.source, args.output_dir).items()}))
    return 0


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
    if config_path.is_symlink():
        raise SetupError("Config path must not be a symlink.")
    if config_path.exists() and args.non_interactive and not args.force:
        raise SetupError(f"Config already exists: {config_path}; pass --force to overwrite.")
    overwrite_approved = args.force
    print(f"narrate setup — writing config to: {config_path}")
    print()

    # Pre-populate from env > existing config > defaults so the user can
    # confirm or override.
    try:
        existing = load_config(config_path)
    except SetupError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2
    seed = resolve_settings(config=existing, cli=args)
    discovery = any((seed.subscription, seed.resource_group, seed.account))
    if discovery:
        discovered_endpoint, discovered_model = discover_deployment(seed)
        if seed.sources["endpoint"] in ("default", "config"):
            seed.endpoint = discovered_endpoint
            seed.sources["endpoint"] = "Azure discovery"
        elif seed.endpoint != discovered_endpoint:
            raise SetupError("Configured endpoint does not match the selected Azure account.")
        if seed.sources["model"] in ("default", "config"):
            seed.model = discovered_model
            seed.sources["model"] = "Azure discovery"
        elif seed.model != discovered_model:
            raise SetupError("Configured model does not match deployment metadata.")

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
    model = _prompt(
        "Model identity (tts or tts-hd, not deployment alias)",
        seed.model, seed.source("model"), non_interactive=args.non_interactive,
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
        voice=voice, speed=speed, auth_mode=auth_mode, model=model,
        subscription=seed.subscription, resource_group=seed.resource_group, account=seed.account,
    )
    try:
        validate_settings(final)
    except SetupError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2
    if discovery and (final.endpoint, final.deployment, final.model) != (
            seed.endpoint, seed.deployment, seed.model):
        discovered_endpoint, discovered_model = discover_deployment(final)
        if (final.endpoint, final.model) != (discovered_endpoint, discovered_model):
            raise SetupError("Edited endpoint/model does not match selected Azure deployment metadata.")

    # Confirm overwrite BEFORE any side effects (Keychain write).
    if config_path.exists() and not args.non_interactive and not args.force:
        ans = input(f"\nOverwrite existing {config_path}? [y/N]: ").strip().lower()
        if ans not in ("y", "yes"):
            print("Aborted; config not written, no secrets stored.")
            return 1
        overwrite_approved = True

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
            "model": model,
            "api_version": api_version,
            "voice": voice,
            "speed": speed,
            "auth_mode": auth_mode,
            **({k: getattr(final, k) for k in ("subscription", "resource_group", "account")}
               if discovery else {}),
        }},
        config_path,
        overwrite=overwrite_approved,
    )
    print(f"\n✓ wrote {written}")
    print("Run `synthesize_tts.py config show` to verify, or kick off a synth.")
    return 0


def az_json(arguments: list[str]) -> dict:
    if not shutil.which("az"):
        raise SetupError("Azure CLI (`az`) is required for deployment discovery.")
    result = subprocess.run(["az", *arguments, "--only-show-errors", "-o", "json"],
                            capture_output=True, text=True, check=False, timeout=60)
    if result.returncode:
        raise SetupError("Read-only Azure metadata lookup failed; check login, subscription, "
                         f"resource names, and read access.\n{result.stderr.strip()}")
    try:
        data = json.loads(result.stdout)
    except ValueError as exc:
        raise SetupError("Azure CLI returned invalid deployment metadata JSON.") from exc
    if not isinstance(data, dict):
        raise SetupError("Azure CLI returned unexpected deployment metadata.")
    return data


def discover_deployment(settings: Settings) -> tuple[str, str]:
    if not all((settings.subscription, settings.resource_group, settings.account)):
        raise SetupError("Azure discovery requires --subscription, --resource-group, and --account.")
    common = ["--subscription", settings.subscription, "--resource-group",
              settings.resource_group, "--name", settings.account]
    account = az_json(["cognitiveservices", "account", "show", *common])
    deployment = az_json(["cognitiveservices", "account", "deployment", "show", *common,
                          "--deployment-name", settings.deployment])
    try:
        endpoint = account["properties"]["endpoint"]
        model = deployment["properties"]["model"]["name"]
    except (KeyError, TypeError) as exc:
        raise SetupError("Azure metadata is missing account endpoint or deployment model identity.") from exc
    if not isinstance(endpoint, str) or not isinstance(model, str):
        raise SetupError("Azure metadata endpoint/model must be strings.")
    discovered = Settings(endpoint=endpoint.rstrip("/"), model=model)
    validate_settings(discovered)
    return discovered.endpoint, discovered.model


def cmd_doctor(args: argparse.Namespace) -> int:
    settings = resolve_settings(config=load_config(args.config), cli=args)
    validate_settings(settings)
    preflight_external_tools(settings.auth_mode)
    if any((settings.subscription, settings.resource_group, settings.account)):
        endpoint, model = discover_deployment(settings)
        if endpoint != settings.endpoint or model != settings.model:
            raise SetupError("Saved endpoint/model does not match Azure deployment metadata; rerun setup.")
        print("[doctor] Azure account and deployment metadata accessible; model matches.")
    else:
        print("[doctor] No discovery context saved; deployment existence/access not checked.")
    if settings.auth_mode == "bearer":
        get_azure_bearer_token(settings.subscription)
        print("[doctor] Cognitive Services bearer token acquired; speech authorization not proven.")
    else:
        key, source = get_api_key(settings.endpoint)
        if not key:
            raise SetupError("API key is missing; set NARRATE_AZURE_OPENAI_API_KEY or use setup.")
        print(f"[doctor] API key available ({source}); key validity and speech access not checked.")
    print("[doctor] No speech request made. Synthesis, quota, and audio quality are NOT proven.")
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
    parsed = urllib.parse.urlsplit(s.endpoint)
    safe_endpoint = f"{parsed.scheme}://{parsed.hostname or '(unset)'}" if s.endpoint else "(unset)"
    print(f"endpoint    : {safe_endpoint}  [{s.source('endpoint')}]")
    print(f"deployment  : {s.deployment}  [{s.source('deployment')}]")
    print(f"model       : {s.model}  [{s.source('model')}]")
    print(f"api_version : {s.api_version}  [{s.source('api_version')}]")
    print(f"voice       : {s.voice}  [{s.source('voice')}]")
    print(f"speed       : {s.speed}  [{s.source('speed')}]")
    print(f"auth_mode   : {s.auth_mode}  [{s.source('auth_mode')}]")
    if s.auth_mode == "api-key" and s.endpoint:
        present = bool(os.environ.get("NARRATE_AZURE_OPENAI_API_KEY", "").strip())
        print(f"api_key     : {'present in env (redacted)' if present else 'not checked; use doctor'}")
    # Tool availability
    print()
    print(f"az          : {'found' if shutil.which('az') else 'MISSING'}")
    print(f"ffmpeg      : {'found' if shutil.which('ffmpeg') else 'MISSING'}")
    print(f"ffprobe     : {'found' if shutil.which('ffprobe') else 'MISSING'}")
    return 0


def offline_plan(args: argparse.Namespace, settings: Settings) -> tuple[str, list[str], Path]:
    """Shared validation. This must not acquire credentials or write any files."""
    validate_settings(settings)
    preflight_external_tools(settings.auth_mode)
    if not 1 <= args.max_chars <= 4096:
        raise SetupError("--max-chars must be between 1 and 4096.")
    if not 1 <= args.preview_words <= 500:
        raise SetupError("--preview-words must be between 1 and 500.")
    if args.max_duration is not None and (
            not math.isfinite(args.max_duration) or args.max_duration <= 0):
        raise SetupError("--max-duration must be a finite positive number of seconds.")
    args.script = args.script.expanduser().resolve()
    if not args.script.is_file():
        raise SetupError(f"Script is not a readable file: {args.script}")
    text = args.script.read_text(encoding="utf-8")
    if not text.strip():
        raise SetupError(f"Script is empty: {args.script}")
    args.output = (args.output.expanduser().absolute() if args.output is not None
                   else output_paths(args.script)["audio"])
    if args.output.suffix.lower() != ".mp3":
        raise SetupError(f"Audio output must have an .mp3 extension: {args.output}")
    # Check the selected base as well: --preview must never legitimize a source collision.
    if args.output.resolve() == args.script:
        raise SetupError("Output must never replace the source script, even with --force.")
    transcript = args.script
    if args.preview:
        args.output = args.output.with_name(f"{args.output.stem}.preview.mp3")
        transcript = args.output.with_suffix(".narration.md")
        text = preview_text(text, args.preview_words)
        assert_output_safe(transcript, args.force, args.allow_tracked, args.script, audio=False)
    assert_output_safe(args.output, args.force, args.allow_tracked, args.script)
    if args.resume_dir is not None:
        root = args.resume_dir.expanduser().absolute()
        reject_symlinks(root)
        for path in (args.script, args.output, transcript):
            if path.resolve().is_relative_to(root.resolve()):
                raise SetupError("Source/output/transcript must not be inside --resume-dir.")
        if root.exists():
            info = root.stat()
            if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
                raise SetupError(f"Cache directory must be private (mode 0700): {root}")
    chunks = chunk_script(text, args.max_chars)
    if not chunks or any(not c.strip() or len(c) > args.max_chars for c in chunks):
        raise SetupError("Chunking failed to produce valid nonempty bounded chunks.")
    return text, chunks, transcript


def cmd_dry_run(args: argparse.Namespace, settings: Settings) -> int:
    text, chunks, transcript = offline_plan(args, settings)
    print(f"[dry-run] source: {args.script}")
    print(f"[dry-run] audio: {args.output}")
    print(f"[dry-run] transcript: {transcript}")
    print(f"[dry-run] model: {settings.model}; deployment alias: {settings.deployment}")
    print(f"[dry-run] voice: {settings.voice}; speed: {settings.speed}")
    print(f"[dry-run] chunks: {len(chunks)}; max chars: {args.max_chars}")
    print(f"[dry-run] estimated duration: {estimate_minutes(text, settings.speed) * 60:.1f}s "
          "(estimate only, not a promise)")
    warn_estimated_duration(text, settings.speed, args.max_duration)
    print("[dry-run] Offline checks passed. Credentials, keychain, deployment access, quota, "
          "and synthesis are NOT checked. Use doctor for explicit readiness checks.")
    return 0


def warn_estimated_duration(text: str, speed: float, maximum: float | None) -> None:
    estimate = estimate_minutes(text, speed) * 60
    if maximum is not None and estimate > maximum:
        print(
            f"WARNING: Estimated duration {estimate:.1f}s exceeds --max-duration {maximum:g}s. "
            "Shorten the script before spending on synthesis. This estimate is not a "
            "measured failure; the actual audio duration enforces the cap.",
            file=sys.stderr,
        )


def auth_kwargs(settings: Settings) -> dict:
    synth_kwargs: dict = dict(
        voice=settings.voice,
        speed=settings.speed,
        endpoint=settings.endpoint,
        deployment=settings.deployment,
        api_version=settings.api_version,
        auth_mode=settings.auth_mode,
        model=settings.model,
    )

    if settings.auth_mode == "bearer":
        cached: dict[str, str] = {}

        def token_provider(force_refresh: bool = False) -> str:
            if force_refresh or "token" not in cached:
                cached["token"] = get_azure_bearer_token(settings.subscription)
            return cached["token"]

        token_provider()
        synth_kwargs["token_provider"] = token_provider
    else:  # api-key
        key, source = get_api_key(settings.endpoint)
        if not key:
            raise SetupError(
                "auth_mode is api-key, but no API key was found.\n"
                "Looked in: NARRATE_AZURE_OPENAI_API_KEY env var, "
                f"and macOS Keychain (service={KEYCHAIN_SERVICE}).\n"
                "Run `synthesize_tts.py setup` to store one, or "
                "switch auth_mode to 'bearer'.\n"
            )
        synth_kwargs["api_key"] = key
    return synth_kwargs


def render_chunks(args: argparse.Namespace, settings: Settings, chunks: list[str],
                  directory: Path, job: ResumeJob | None) -> list[Path]:
    kwargs = None
    parts = []
    for index, chunk in enumerate(chunks, 1):
        reused = job.reuse(index) if job is not None else None
        if reused is not None:
            print(f"[resume] reusing chunk {index}/{len(chunks)}")
            parts.append(reused)
            continue
        if kwargs is None:
            kwargs = auth_kwargs(settings)
        part = directory / f"part-{index:05d}.mp3"
        if job is not None:
            safe_cache_file(part)
        print(f"[{args.script.name}] synthesizing chunk {index}/{len(chunks)}...")
        with unique_sibling(part) as temporary:
            BACKENDS[args.backend](chunk, temporary, **kwargs)
            verify_audio(temporary)
            os.replace(temporary, part)
        if job is not None:
            job.record(part)
        parts.append(part)
    return parts


def cmd_synth(args: argparse.Namespace) -> int:
    settings = resolve_settings(config=load_config(args.config), cli=args)
    if args.dry_run:
        return cmd_dry_run(args, settings)
    text, chunks, transcript = offline_plan(args, settings)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    print(f"[{args.script.name}] {len(text):,} chars -> {len(chunks)} chunk(s)")
    print(f"Estimated duration: {estimate_minutes(text, settings.speed) * 60:.1f}s (not a promise)")
    warn_estimated_duration(text, settings.speed, args.max_duration)
    with tempfile.TemporaryDirectory(prefix="narrate-") as tmp:
        if args.resume_dir is not None:
            key = job_identity(text, settings, args)
            with resume_job(args.resume_dir, key, [args.script, args.output, transcript]) as job:
                parts = render_chunks(args, settings, chunks, job.directory, job)
                duration = finish_render(args, parts, transcript, text)
        else:
            parts = render_chunks(args, settings, chunks, Path(tmp), None)
            duration = finish_render(args, parts, transcript, text)
    print(f"Audio: {args.output}\nTranscript: {transcript}\nActual duration: {duration:.2f}s")
    if args.resume_dir is not None:
        print(f"Resume job: {job.directory} (sensitive audio retained; manual cleanup only)")
    return 0


def finish_render(args: argparse.Namespace, parts: list[Path],
                  transcript: Path, text: str) -> float:
    assert_output_safe(args.output, args.force, args.allow_tracked, args.script)
    if not args.preview:
        return concat_mp3s(parts, args.output, max_duration=args.max_duration, force=args.force)
    # Validate first, then roll back the transcript if audio publication fails.
    assert_output_safe(transcript, args.force, args.allow_tracked, args.script, audio=False)
    with (unique_sibling(args.output) as audio_tmp,
          unique_sibling(transcript) as script_tmp,
          unique_sibling(transcript) as script_backup):
        duration = concat_mp3s(parts, audio_tmp, max_duration=args.max_duration, force=True)
        script_tmp.write_text(text, encoding="utf-8")
        had_transcript = transcript.exists()
        if had_transcript:
            shutil.copyfile(transcript, script_backup)
        published = script_tmp.stat()
        publish_file(script_tmp, transcript, args.force)
        try:
            publish_file(audio_tmp, args.output, args.force)
        except (OSError, SetupError) as publish_error:
            try:
                if transcript.exists():
                    current = transcript.stat()
                    if (current.st_dev, current.st_ino) != (published.st_dev, published.st_ino):
                        raise SetupError(
                            f"Audio publication failed; transcript changed concurrently and was "
                            f"left untouched: {transcript}. Original error: {publish_error}"
                        ) from publish_error
                    if had_transcript:
                        os.replace(script_backup, transcript)
                    else:
                        transcript.unlink()
            except OSError as rollback_error:
                raise SetupError(
                    f"Audio publication failed ({publish_error}); transcript rollback failed "
                    f"for {transcript}: {rollback_error}"
                ) from publish_error
            raise
    return duration


# ----------------------------------------------------------------------------
# Entry point: subcommand pre-dispatch
# ----------------------------------------------------------------------------


SUBCOMMANDS = {"setup", "config", "doctor", "output-path"}


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])
    try:
        if argv and argv[0] in SUBCOMMANDS:
            cmd = argv[0]
            rest = argv[1:]
            if cmd == "setup":
                return cmd_setup(parse_setup_args(rest))
            if cmd == "config":
                return cmd_config(parse_config_args(rest))
            if cmd == "doctor":
                return cmd_doctor(parse_doctor_args(rest))
            if cmd == "output-path":
                return cmd_output_path(rest)
        return cmd_synth(parse_synth_args(argv))
    except (SetupError, OSError, UnicodeError, ValueError, subprocess.TimeoutExpired) as exc:
        sys.stderr.write(f"narrate: {exc}\n")
        return 2
    except (EOFError, KeyboardInterrupt):
        sys.stderr.write("narrate: Cancelled. For unattended setup, use --non-interactive.\n")
        return 130


if __name__ == "__main__":
    sys.exit(main())
