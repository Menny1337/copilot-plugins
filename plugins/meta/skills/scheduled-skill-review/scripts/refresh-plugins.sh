#!/usr/bin/env bash
# Refresh a configured Copilot marketplace. Registered GitHub sources use system
# Git so private repositories retain their configured credential helpers.
set -uo pipefail

MARKETPLACE_NAME="${1:-}"
COPILOT_HOME_DIR="${COPILOT_HOME:-$HOME/.copilot}"
REFRESH_TOKEN=""
REFRESH_HEARTBEAT_PID=""
CANDIDATE_PATH=""
PREVIOUS_PATH=""
LINK_PATH=""
ACTIVE_CACHE_PATH=""

cache_root() {
  if [ -n "${COPILOT_CACHE_HOME:-}" ]; then
    printf '%s' "$COPILOT_CACHE_HOME"
    return
  fi
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Darwin) printf '%s' "$HOME/Library/Caches/copilot" ;;
    Linux) printf '%s' "${XDG_CACHE_HOME:-$HOME/.cache}/copilot" ;;
    *) printf '%s' "${LOCALAPPDATA:-$HOME/.cache}/copilot" ;;
  esac
}

state_root() {
  printf '%s/marketplace-state' "$COPILOT_HOME_DIR"
}

acquire_lease() {
  local name="$1"
  local ttl="$2"
  local token
  local attempts=0
  local now expires acquired db
  token="$(node -e 'process.stdout.write(require("crypto").randomUUID())')" || return 1
  db="$(state_root)/locks.sqlite3"
  mkdir -p "$(dirname "$db")" || return 1
  while [ "$attempts" -lt 300 ]; do
    now="$(date +%s)"
    expires=$((now + ttl))
    acquired="$(
      (umask 077; sqlite3 "$db" <<SQL
.timeout 5000
CREATE TABLE IF NOT EXISTS leases (
  name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
BEGIN IMMEDIATE;
DELETE FROM leases WHERE expires_at <= $now;
INSERT OR IGNORE INTO leases(name, token, expires_at)
VALUES('$name', '$token', $expires);
SELECT changes();
COMMIT;
SQL
      )
    )" || return 1
    if [ "$(printf '%s\n' "$acquired" | tail -n 1)" = "1" ]; then
      printf '%s' "$token"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  echo "Timed out waiting for marketplace coordination lock '$name'." >&2
  return 1
}

release_lease() {
  local name="$1"
  local token="$2"
  local db
  db="$(state_root)/locks.sqlite3"
  [ -f "$db" ] || return 0
  sqlite3 "$db" "PRAGMA busy_timeout=5000; DELETE FROM leases WHERE name='$name' AND token='$token';" >/dev/null 2>&1
}

lease_owned() {
  local name="$1"
  local token="$2"
  local db
  db="$(state_root)/locks.sqlite3"
  [ -f "$db" ] || return 1
  sqlite3 "$db" "PRAGMA busy_timeout=5000; SELECT count(*) FROM leases WHERE name='$name' AND token='$token' AND expires_at > strftime('%s','now');" 2>/dev/null |
    tail -n 1 | grep -qx 1
}

renew_lease() {
  local name="$1"
  local token="$2"
  local ttl="$3"
  local db expires
  db="$(state_root)/locks.sqlite3"
  expires=$(( $(date +%s) + ttl ))
  [ -f "$db" ] || return 1
  sqlite3 "$db" "PRAGMA busy_timeout=5000; UPDATE leases SET expires_at=$expires WHERE name='$name' AND token='$token'; SELECT changes();" 2>/dev/null |
    tail -n 1 | grep -qx 1
}

lease_heartbeat() {
  local name="$1"
  local token="$2"
  local ttl="$3"
  local owner_pid="$4"
  while kill -0 "$owner_pid" 2>/dev/null; do
    sleep 30
    kill -0 "$owner_pid" 2>/dev/null || return 0
    renew_lease "$name" "$token" "$ttl" || {
      kill -TERM "$owner_pid" 2>/dev/null || true
      return 1
    }
  done
}

marketplace_source() {
  # shellcheck disable=SC2016
  SETTINGS="$COPILOT_HOME_DIR/settings.json" MARKETPLACE="$MARKETPLACE_NAME" \
    node -e '
      const fs = require("fs");
      if (!fs.existsSync(process.env.SETTINGS)) process.exit(0);
      const settings = JSON.parse(fs.readFileSync(process.env.SETTINGS, "utf8"));
      const source = settings.extraKnownMarketplaces?.[process.env.MARKETPLACE]?.source;
      if (source?.source === "github" && typeof source.repo === "string") {
        process.stdout.write(`github\t${source.repo}`);
      } else if (source?.source === "git" && typeof source.url === "string") {
        process.stdout.write(`git\t${source.url}`);
      } else if (source?.source === "directory" && typeof source.path === "string") {
        process.stdout.write(`directory\t${source.path}`);
      }
    ' 2>/dev/null
}

validate_marketplace_checkout() {
  local cache="$1"
  # shellcheck disable=SC2016
  CACHE="$cache" MARKETPLACE="$MARKETPLACE_NAME" node -e '
    const fs = require("fs");
    const path = require("path");
    const cache = path.resolve(process.env.CACHE);
    const candidates = [
      "marketplace.json",
      ".plugin/marketplace.json",
      ".github/plugin/marketplace.json",
      ".claude-plugin/marketplace.json"
    ];
    const rel = candidates.find(p => fs.existsSync(path.join(cache, p)));
    if (!rel) throw new Error(`Marketplace manifest is missing from ${cache}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(cache, rel), "utf8"));
    if (manifest?.name !== process.env.MARKETPLACE) {
      throw new Error(`Expected marketplace ${process.env.MARKETPLACE}, found ${manifest?.name ?? "none"}`);
    }
    if (!Array.isArray(manifest.plugins)) throw new Error("Marketplace plugins must be an array");
    for (const plugin of manifest.plugins) {
      if (!plugin || typeof plugin.name !== "string" || !plugin.name) {
        throw new Error("Every marketplace plugin needs a name");
      }
      if (typeof plugin.source === "string") {
        const source = path.resolve(cache, plugin.source);
        if (source !== cache && !source.startsWith(`${cache}${path.sep}`)) {
          throw new Error(`Plugin ${plugin.name} source escapes the marketplace checkout`);
        }
        if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
          throw new Error(`Plugin ${plugin.name} source is missing: ${plugin.source}`);
        }
      } else if (!plugin.source || typeof plugin.source !== "object") {
        throw new Error(`Plugin ${plugin.name} needs a source`);
      }
    }
  '
}

validate_remote_url() {
  local url="$1"
  URL="$url" node -e '
    const raw = process.env.URL;
    const match = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (!match || !["http", "https"].includes(match[1].toLowerCase())) process.exit(0);
    const parsed = new URL(raw);
    if (parsed.username || parsed.password) {
      console.error("Refusing a credential-bearing HTTP(S) marketplace URL.");
      process.exit(1);
    }
    if (parsed.search || parsed.hash) {
      console.error("Refusing an HTTP(S) marketplace URL with a query or fragment.");
      process.exit(1);
    }
  '
}

canonical_remote() {
  local url="$1"
  case "$url" in
    https://github.com/*)
      url="github.com/${url#https://github.com/}"
      ;;
    http://github.com/*)
      url="github.com/${url#http://github.com/}"
      ;;
    ssh://git@github.com/*)
      url="github.com/${url#ssh://git@github.com/}"
      ;;
    git@github.com:*)
      url="github.com/${url#git@github.com:}"
      ;;
  esac
  url="${url%/}"
  url="${url%.git}"
  printf '%s' "$url"
}

is_managed_cache_path() {
  local cache="$1"
  # shellcheck disable=SC2016
  CACHE="$cache" ROOT="$(cache_root)/marketplaces" node -e '
    const path = require("path");
    const cache = path.resolve(process.env.CACHE);
    const root = path.resolve(process.env.ROOT);
    process.exit(cache.startsWith(`${root}${path.sep}`) ? 0 : 1);
  '
}

prepare_versions_root() {
  local versions="$1"
  local entry base

  if [ -L "$versions" ] || { [ -e "$versions" ] && [ ! -d "$versions" ]; }; then
    echo "Marketplace version store is not a managed directory: $versions" >&2
    return 1
  fi
  mkdir -p "$versions" || return 1
  if [ ! -f "$versions/.managed-versions" ]; then
    for entry in "$versions"/*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      base="$(basename "$entry")"
      case "$base" in
        version-*|previous-*) ;;
        *)
          echo "Marketplace version store contains an unowned entry: $entry" >&2
          return 1
          ;;
      esac
      if [ ! -d "$entry" ] || [ -L "$entry" ]; then
        echo "Marketplace version store contains an unsafe entry: $entry" >&2
        return 1
      fi
    done
    (umask 077; : > "$versions/.managed-versions") || return 1
  fi
}

remote_source_file() {
  printf '%s/sources/%s.url' "$(state_root)" "$MARKETPLACE_NAME"
}

remember_remote() {
  local url="$1"
  local source_path
  local tmp
  source_path="$(remote_source_file)"
  tmp="${source_path}.tmp.$$"

  validate_remote_url "$url" || return 1
  mkdir -p "$(dirname "$source_path")" || return 1
  (umask 077; printf '%s\n' "$url" > "$tmp" && mv "$tmp" "$source_path") || {
    rm -f "$tmp"
    return 1
  }
}

read_remembered_remote() {
  local source_path
  local remote
  source_path="$(remote_source_file)"
  [ -f "$source_path" ] || return 1
  IFS= read -r remote < "$source_path" || return 1
  [ -n "$remote" ] || return 1
  printf '%s' "$remote"
}

refresh_git_checkout() {
  local url="$1"
  local cache="$2"
  local origin suffix versions current_target="" new_target="" version_dir had_cache=0

  validate_remote_url "$url" || return 1
  mkdir -p "$(dirname "$cache")" || return 1
  if [ -L "$cache" ]; then
    if [ ! -d "$cache/.git" ]; then
      rm -f "$cache" || return 1
    else
      origin="$(git -C "$cache" remote get-url origin 2>/dev/null)" || {
        echo "Marketplace checkout has no origin remote: $cache" >&2
        return 1
      }
      validate_remote_url "$origin" || {
        echo "Marketplace cache origin is not safe to persist or log: $cache" >&2
        return 1
      }
      if [ "$(canonical_remote "$origin")" != "$(canonical_remote "$url")" ]; then
        echo "Marketplace cache origin does not match its configured source: $cache" >&2
        return 1
      fi
      validate_marketplace_checkout "$cache" || return 1
      current_target="$(cd "$cache" && pwd -P)" || return 1
      had_cache=1
    fi
  elif [ -d "$cache/.git" ]; then
    origin="$(git -C "$cache" remote get-url origin 2>/dev/null)" || {
      echo "Marketplace checkout has no origin remote: $cache" >&2
      return 1
    }
    validate_remote_url "$origin" || {
      echo "Marketplace cache origin is not safe to persist or log: $cache" >&2
      return 1
    }
    if [ "$(canonical_remote "$origin")" != "$(canonical_remote "$url")" ]; then
      echo "Marketplace cache origin does not match its configured source: $cache" >&2
      return 1
    fi
    validate_marketplace_checkout "$cache" || return 1
    echo "Legacy marketplace cache requires one-time migration by the interactive launcher: $cache" >&2
    return 1
  elif [ -e "$cache" ]; then
    echo "Marketplace cache exists but is not a Git checkout: $cache" >&2
    return 1
  fi

  suffix="$(node -e 'process.stdout.write(require("crypto").randomUUID())')" || return 1
  versions="${cache}.versions"
  prepare_versions_root "$versions" || return 1
  CANDIDATE_PATH="$versions/version-$suffix"
  PREVIOUS_PATH=""
  LINK_PATH=""
  ACTIVE_CACHE_PATH="$cache"
  git clone --depth 1 "$url" "$CANDIDATE_PATH" || return 1

  origin="$(git -C "$CANDIDATE_PATH" remote get-url origin 2>/dev/null)" || {
    echo "Candidate marketplace checkout has no origin remote." >&2
    return 1
  }
  validate_remote_url "$origin" || return 1
  if [ "$(canonical_remote "$origin")" != "$(canonical_remote "$url")" ]; then
    echo "Candidate marketplace origin does not match its configured source." >&2
    return 1
  fi
  validate_marketplace_checkout "$CANDIDATE_PATH" || return 1
  lease_owned "refresh-$MARKETPLACE_NAME" "$REFRESH_TOKEN" || {
    echo "Marketplace refresh lease was lost before activation." >&2
    return 1
  }

  LINK_PATH="${cache}.link-$suffix"
  ln -s "$CANDIDATE_PATH" "$LINK_PATH" || return 1
  if [ "$had_cache" -eq 1 ] && [ ! -L "$cache" ]; then
    PREVIOUS_PATH="$versions/previous-$suffix"
    mv "$cache" "$PREVIOUS_PATH" || return 1
  elif [ -n "$current_target" ]; then
    PREVIOUS_PATH="$current_target"
  fi

  if ! FROM="$LINK_PATH" TO="$cache" node -e '
    require("fs").renameSync(process.env.FROM, process.env.TO)
  '; then
    if [ "$had_cache" -eq 1 ] && [ -n "$PREVIOUS_PATH" ] &&
       [ -d "$PREVIOUS_PATH" ] && [ ! -e "$cache" ] && [ ! -L "$cache" ]; then
      mv "$PREVIOUS_PATH" "$cache" || return 1
      PREVIOUS_PATH=""
    fi
    return 1
  fi
  LINK_PATH=""
  new_target="$CANDIDATE_PATH"
  CANDIDATE_PATH=""

  for version_dir in "$versions"/*; do
    [ -d "$version_dir" ] || continue
    case "$(basename "$version_dir")" in
      version-*|previous-*)
        if [ ! -L "$version_dir" ] && [ "$version_dir" != "$new_target" ] &&
           [ "$version_dir" != "$PREVIOUS_PATH" ]; then
          rm -rf "$version_dir"
        fi
        ;;
    esac
  done
  PREVIOUS_PATH=""
  ACTIVE_CACHE_PATH=""

  remember_remote "$url"
}

register_local_marketplace() {
  local cache="$1"
  local lock_token status=0
  lock_token="$(acquire_lease settings 60)" || return 1
  # shellcheck disable=SC2016
  SETTINGS="$COPILOT_HOME_DIR/settings.json" MARKETPLACE="$MARKETPLACE_NAME" CACHE="$cache" \
    node -e '
      const fs = require("fs");
      const path = require("path");
      const exists = fs.existsSync(process.env.SETTINGS);
      const settings = exists
        ? JSON.parse(fs.readFileSync(process.env.SETTINGS, "utf8"))
        : {};
      settings.extraKnownMarketplaces ||= {};
      settings.extraKnownMarketplaces[process.env.MARKETPLACE] = {
        source: { source: "directory", path: process.env.CACHE }
      };
      fs.mkdirSync(path.dirname(process.env.SETTINGS), { recursive: true });
      const tmp = `${process.env.SETTINGS}.tmp-${process.pid}`;
      const mode = exists ? fs.statSync(process.env.SETTINGS).mode & 0o777 : 0o600;
      fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode });
      fs.renameSync(tmp, process.env.SETTINGS);
    ' || status=$?
  release_lease settings "$lock_token"
  return "$status"
}

update_installed_marketplace_plugins() {
  local root="$COPILOT_HOME_DIR/installed-plugins/$MARKETPLACE_NAME"
  local found=0
  local failed=0
  local dir

  if [ ! -d "$root" ]; then
    echo "No globally installed plugins for marketplace '$MARKETPLACE_NAME'." >&2
    return 0
  fi

  for dir in "$root"/*; do
    [ -d "$dir" ] || continue
    found=1
    copilot plugin update "$(basename "$dir")@$MARKETPLACE_NAME" || failed=1
  done

  [ "$found" -eq 1 ] || echo "No globally installed plugins for marketplace '$MARKETPLACE_NAME'." >&2
  return "$failed"
}

release_refresh_lock() {
  local active_target=""
  if [ -n "$REFRESH_HEARTBEAT_PID" ]; then
    kill "$REFRESH_HEARTBEAT_PID" 2>/dev/null || true
    wait "$REFRESH_HEARTBEAT_PID" 2>/dev/null || true
    REFRESH_HEARTBEAT_PID=""
  fi
  if [ -n "$PREVIOUS_PATH" ] && [ -d "$PREVIOUS_PATH" ] &&
     [ -n "$ACTIVE_CACHE_PATH" ] && [ ! -e "$ACTIVE_CACHE_PATH" ]; then
    mv "$PREVIOUS_PATH" "$ACTIVE_CACHE_PATH" 2>/dev/null || true
  fi
  [ -n "$LINK_PATH" ] && rm -f "$LINK_PATH"
  if [ -n "$CANDIDATE_PATH" ] && [ -n "$ACTIVE_CACHE_PATH" ]; then
    active_target="$(readlink "$ACTIVE_CACHE_PATH" 2>/dev/null || true)"
  fi
  if [ -n "$CANDIDATE_PATH" ] && [ "$active_target" != "$CANDIDATE_PATH" ]; then
    rm -rf "$CANDIDATE_PATH"
  fi
  CANDIDATE_PATH=""
  PREVIOUS_PATH=""
  LINK_PATH=""
  ACTIVE_CACHE_PATH=""
  if [ -n "$REFRESH_TOKEN" ]; then
    release_lease "refresh-$MARKETPLACE_NAME" "$REFRESH_TOKEN"
    REFRESH_TOKEN=""
  fi
}

acquire_refresh_lock() {
  REFRESH_TOKEN="$(acquire_lease "refresh-$MARKETPLACE_NAME" 180)" || return 1
  lease_heartbeat "refresh-$MARKETPLACE_NAME" "$REFRESH_TOKEN" 180 "$$" &
  REFRESH_HEARTBEAT_PID=$!
  trap release_refresh_lock EXIT
  trap 'release_refresh_lock; exit 130' INT
  trap 'release_refresh_lock; exit 143' TERM
  trap 'release_refresh_lock; exit 129' HUP
}

command -v copilot >/dev/null 2>&1 || {
  echo "copilot is unavailable; installed plugins were not refreshed" >&2
  exit 127
}
command -v sqlite3 >/dev/null 2>&1 || {
  echo "sqlite3 is unavailable; marketplace coordination cannot run" >&2
  exit 127
}

if [ -n "$MARKETPLACE_NAME" ]; then
  case "$MARKETPLACE_NAME" in
    *[!A-Za-z0-9._-]*)
      echo "Invalid marketplace name: $MARKETPLACE_NAME" >&2
      exit 2
      ;;
  esac
  acquire_refresh_lock || exit 1
  if ! source_info="$(marketplace_source)"; then
    echo "Could not read marketplace source from $COPILOT_HOME_DIR/settings.json." >&2
    exit 1
  fi
  source_type="${source_info%%	*}"
  source_value="${source_info#*	}"

  if [ "$source_type" = "github" ] && [ -n "$source_value" ]; then
    if ! printf '%s\n' "$source_value" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
      echo "Invalid GitHub marketplace repository: $source_value" >&2
      exit 2
    fi
    echo "Refreshing GitHub marketplace with system Git: $source_value" >&2
    remote_url="https://github.com/$source_value.git"
    cache="$(cache_root)/marketplaces/${source_value//\//-}"
    refresh_git_checkout "$remote_url" "$cache" || exit 1
    register_local_marketplace "$cache" || exit 1
  elif [ "$source_type" = "git" ] && [ -n "$source_value" ]; then
    validate_remote_url "$source_value" || exit 1
    echo "Refreshing configured Git marketplace with system Git." >&2
    cache="$(cache_root)/marketplaces/${MARKETPLACE_NAME}-local"
    refresh_git_checkout "$source_value" "$cache" || exit 1
    register_local_marketplace "$cache" || exit 1
  elif [ "$source_type" = "directory" ]; then
    cache="$source_value"
    if [ -d "$cache/.git" ]; then
      if is_managed_cache_path "$cache" &&
         remote_url="$(read_remembered_remote 2>/dev/null)"; then
        echo "Refreshing managed local Git marketplace cache: $cache" >&2
        refresh_git_checkout "$remote_url" "$cache" || exit 1
      elif validate_marketplace_checkout "$cache"; then
        output="$(copilot plugin marketplace update "$MARKETPLACE_NAME" 2>&1)"
        status=$?
        printf '%s\n' "$output"
        [ "$status" -eq 0 ] || exit "$status"
      else
        echo "Local marketplace path is incomplete: $cache" >&2
        exit 1
      fi
    elif [ ! -e "$cache" ]; then
      is_managed_cache_path "$cache" || {
        echo "Refusing to recreate an unmanaged directory marketplace path: $cache" >&2
        exit 1
      }
      remote_url="$(read_remembered_remote 2>/dev/null || true)"
      [ -n "$remote_url" ] || {
        echo "Local marketplace cache is missing and no remembered remote exists: $cache" >&2
        exit 1
      }
      echo "Recreating missing local marketplace cache: $cache" >&2
      refresh_git_checkout "$remote_url" "$cache" || exit 1
    elif validate_marketplace_checkout "$cache"; then
      output="$(copilot plugin marketplace update "$MARKETPLACE_NAME" 2>&1)"
      status=$?
      printf '%s\n' "$output"
      [ "$status" -eq 0 ] || exit "$status"
    else
      echo "Local marketplace path is incomplete: $cache" >&2
      exit 1
    fi
  else
    output="$(copilot plugin marketplace update "$MARKETPLACE_NAME" 2>&1)"
    status=$?
    printf '%s\n' "$output"
    if [ "$status" -ne 0 ] || printf '%s\n' "$output" | grep -q 'Failed to update marketplace'; then
      echo "Marketplace refresh failed for '$MARKETPLACE_NAME'." >&2
      exit 1
    fi
  fi

  release_refresh_lock
  update_installed_marketplace_plugins
else
  copilot plugin update --all
fi
