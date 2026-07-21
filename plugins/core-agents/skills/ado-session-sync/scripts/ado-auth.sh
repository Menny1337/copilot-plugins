#!/usr/bin/env bash
# ado-auth.sh — establish a headless ADO auth context for ado-session-sync.
#
# WHY: the session-yield sync runs `az boards` / `az devops` HEADLESSLY. Relying on
# the ambient `az login` identity breaks when the active subscription is the wrong
# tenant for the ADO org — e.g. a personal MSA subscription is active (you're working
# in another repo) while the org is corp-tenant: az boards returns TF400813 / HTTP 401.
#
# HOW (frictionless, zero-config): mint a short-lived Microsoft Entra (AAD) access
# token for the org's tenant from your EXISTING `az login`, and hand it to `az devops`
# / `az boards` via the AZURE_DEVOPS_EXT_PAT env var (the CLI accepts an AAD bearer
# token there, not only a PAT). The org's backing tenant is auto-detected; a logged-in
# subscription in that tenant is pinned so `az account get-access-token` uses the right
# account+tenant even when a personal/MSA subscription is your active default — WITHOUT
# switching it. Nothing is changed, so nothing needs changing back. The token lives ~1h
# and is re-minted fresh on every session yield.
#
# Requirement: be `az login`'d to the org's tenant at least once (you normally are).
# No PAT, no browser, no admin, no policy dependency. Some orgs disable PAT creation
# entirely (disablePatCreationPolicyViolation) — the AAD path sidesteps that.
#
# DUAL MODE:
#   • SOURCED ( . ado-auth.sh )  -> exports AZURE_DEVOPS_EXT_PAT when a token resolves;
#                                   prints nothing (never leaks the secret). Fail-open:
#                                   nothing resolvable => env untouched (ambient az auth).
#   • EXECUTED ( ado-auth … )    -> a small CLI (see `ado-auth help`).
#
# AUTH RESOLUTION ORDER (first hit wins):
#   1. $AZURE_DEVOPS_EXT_PAT already in the environment (respected as-is)
#   2. a stored PAT  — config ado.patFile, ado.patEnv, or ~/.copilot/assistant/.ado-pat
#                      (optional fallback, for orgs where PATs are allowed/preferred)
#   3. a fresh AAD token minted from `az` for the org's tenant  (the default path)
#
# Best-effort and fail-open: a missing token never raises an error when sourced.

# Well-known Azure DevOps Entra application/resource ID (stable across all tenants/orgs).
_ADO_RESOURCE="499b84ac-1321-427f-aa17-267ca6975798"

_ADO_AUTH_CONFIG="${COPILOT_PLUGIN_ADO_CONFIG:-$HOME/.copilot/assistant/config.json}"
_ADO_AUTH_DEFAULT_FILE="${COPILOT_PLUGIN_ADO_PAT_FILE:-$HOME/.copilot/assistant/.ado-pat}"
_ADO_TENANT_CACHE="${COPILOT_PLUGIN_ADO_TENANT_CACHE:-$HOME/.copilot/assistant/.ado-tenant}"

# Read a scalar from the assistant config via jq; empty when absent/unavailable.
_ado_cfg() {
  [ -f "$_ADO_AUTH_CONFIG" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  local v
  v="$(jq -r "${1} // empty" "$_ADO_AUTH_CONFIG" 2>/dev/null)" || return 1
  [ -n "$v" ] && printf '%s' "$v"
}

# Expand a leading ~ (no eval; safe for config-sourced paths).
_ado_expand_tilde() {
  case "$1" in
    "~")   printf '%s' "$HOME" ;;
    "~/"*) printf '%s' "$HOME${1#\~}" ;;
    *)     printf '%s' "$1" ;;
  esac
}

# Resolve a config-supplied path to an absolute path. A leading ~ is expanded;
# a still-relative path is anchored under ~/.copilot/assistant (NEVER the cwd, so a
# secret can't be dropped into whatever repo the session happens to run from).
_ado_resolve_path() {
  local p
  p="$(_ado_expand_tilde "$1")"
  case "$p" in
    /*) printf '%s' "$p" ;;
    *)  printf '%s' "$HOME/.copilot/assistant/$p" ;;
  esac
}

# True only for a syntactically valid shell variable name. Guards ${!name}
# indirection: a numeric/empty/punctuated name would expand a positional
# parameter or error under set -u.
_ado_valid_varname() {
  case "$1" in
    ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) return 1 ;;
    *) return 0 ;;
  esac
}

# Echo the resolved PAT *file* path (may not exist): config ado.patFile else default.
_ado_resolve_pat_file() {
  local pf
  pf="$(_ado_cfg '.ado.patFile')"
  if [ -n "$pf" ]; then _ado_resolve_path "$pf"; return 0; fi
  printf '%s' "$_ADO_AUTH_DEFAULT_FILE"
}

# Print a stored PAT if one resolves (env override / patFile / patEnv / default file).
# Non-zero exit when none found.
_ado_read_pat() {
  if [ -n "${AZURE_DEVOPS_EXT_PAT:-}" ]; then printf '%s' "$AZURE_DEVOPS_EXT_PAT"; return 0; fi
  local pf env_name val
  pf="$(_ado_cfg '.ado.patFile')"
  if [ -n "$pf" ]; then
    pf="$(_ado_resolve_path "$pf")"
    if [ -f "$pf" ]; then
      val="$(tr -d '\r\n' < "$pf" 2>/dev/null)"
      [ -n "$val" ] && { printf '%s' "$val"; return 0; }
    fi
  fi
  env_name="$(_ado_cfg '.ado.patEnv')"
  if _ado_valid_varname "$env_name"; then
    val="${!env_name:-}"; [ -n "$val" ] && { printf '%s' "$val"; return 0; }
  fi
  if [ -f "$_ADO_AUTH_DEFAULT_FILE" ]; then
    val="$(tr -d '\r\n' < "$_ADO_AUTH_DEFAULT_FILE" 2>/dev/null)"
    [ -n "$val" ] && { printf '%s' "$val"; return 0; }
  fi
  return 1
}

# Detect the org's backing Entra tenant from its unauthenticated 401 challenge.
# Azure DevOps advertises X-VSS-ResourceTenant on any org request. No secret needed.
_ado_detect_tenant() {
  local org="$1" t
  [ -n "$org" ] || return 1
  command -v curl >/dev/null 2>&1 || return 1
  t="$(curl -sSI --max-time 6 "$org" 2>/dev/null \
        | tr -d '\r' \
        | awk -F': ' 'tolower($1)=="x-vss-resourcetenant"{print $2; exit}')"
  case "$t" in
    [0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*-[0-9a-fA-F]*) printf '%s' "$t"; return 0 ;;
  esac
  return 1
}

# Resolve the tenant to mint an org token for: config ado.tenantId (explicit override)
# else the cached detection else a fresh detection (cached for next time). Empty when
# undetectable (caller falls back to the active tenant).
_ado_org_tenant() {
  local org="$1" tid cached
  tid="$(_ado_cfg '.ado.tenantId')"; [ -n "$tid" ] && { printf '%s' "$tid"; return 0; }
  [ -n "$org" ] || return 1
  if [ -f "$_ADO_TENANT_CACHE" ]; then
    cached="$(awk -v o="$org" -F'\t' '$1==o{print $2; exit}' "$_ADO_TENANT_CACHE" 2>/dev/null)"
    [ -n "$cached" ] && { printf '%s' "$cached"; return 0; }
  fi
  tid="$(_ado_detect_tenant "$org")" || return 1
  ( umask 077; printf '%s\t%s\n' "$org" "$tid" >> "$_ADO_TENANT_CACHE" ) 2>/dev/null || true
  printf '%s' "$tid"
}

# Find a logged-in subscription whose home tenant is the org's tenant.
# WHY pin a subscription (not --tenant): `get-access-token --tenant <t>` uses the
# ACTIVE account's identity, so when a personal/MSA subscription is the default it
# fails AADSTS50020 ("user … does not exist in tenant"). Pinning a subscription in the
# org's tenant selects THAT subscription's account+tenant regardless of the active
# default — the robust path for the "working in another repo on personal az" case.
_ado_org_subscription() {
  local tid="$1" sub
  [ -n "$tid" ] || return 1
  sub="$(az account list --all --query "[?tenantId=='$tid' && state=='Enabled'].id | [0]" -o tsv 2>/dev/null)"
  [ -n "$sub" ] && { printf '%s' "$sub"; return 0; }
  sub="$(az account list --all --query "[?tenantId=='$tid'].id | [0]" -o tsv 2>/dev/null)"
  [ -n "$sub" ] && { printf '%s' "$sub"; return 0; }
  return 1
}

# Mint a fresh AAD access token for the ADO resource in the org's tenant.
# Reads that account's cached refresh token; does NOT switch the active subscription.
# Non-zero (no output) when az is absent or no usable login exists.
_ado_aad_token() {
  command -v az >/dev/null 2>&1 || return 1
  local org tid sub tok
  org="$(_ado_cfg '.ado.org')" || true
  tid="$(_ado_org_tenant "$org" 2>/dev/null || true)"
  if [ -n "$tid" ] && sub="$(_ado_org_subscription "$tid")"; then
    tok="$(az account get-access-token --subscription "$sub" --resource "$_ADO_RESOURCE" --query accessToken -o tsv 2>/dev/null)"
  elif [ -n "$tid" ]; then
    tok="$(az account get-access-token --tenant "$tid" --resource "$_ADO_RESOURCE" --query accessToken -o tsv 2>/dev/null)"
  else
    tok="$(az account get-access-token --resource "$_ADO_RESOURCE" --query accessToken -o tsv 2>/dev/null)"
  fi
  [ -n "$tok" ] && { printf '%s' "$tok"; return 0; }
  return 1
}

# Resolve the auth token to export: stored PAT first (explicit), else a fresh AAD token.
_ado_resolve_token() {
  local t
  if t="$(_ado_read_pat)"; then printf '%s' "$t"; return 0; fi
  if t="$(_ado_aad_token)"; then printf '%s' "$t"; return 0; fi
  return 1
}

# Label the source a token WOULD resolve from — never the value. Non-zero when none.
_ado_token_source() {
  if [ -n "${AZURE_DEVOPS_EXT_PAT:-}" ]; then printf 'env:AZURE_DEVOPS_EXT_PAT'; return 0; fi
  local pf env_name
  pf="$(_ado_cfg '.ado.patFile')"
  if [ -n "$pf" ]; then
    pf="$(_ado_resolve_path "$pf")"
    [ -s "$pf" ] && { printf 'PAT file:%s (ado.patFile)' "$pf"; return 0; }
  fi
  env_name="$(_ado_cfg '.ado.patEnv')"
  if _ado_valid_varname "$env_name"; then
    [ -n "${!env_name:-}" ] && { printf 'PAT env:%s (ado.patEnv)' "$env_name"; return 0; }
  fi
  [ -s "$_ADO_AUTH_DEFAULT_FILE" ] && { printf 'PAT file:%s (default)' "$_ADO_AUTH_DEFAULT_FILE"; return 0; }
  if command -v az >/dev/null 2>&1; then
    local org tid
    org="$(_ado_cfg '.ado.org')"
    tid="$(_ado_org_tenant "$org" 2>/dev/null || true)"
    printf 'AAD via az (tenant %s)' "${tid:-active}"
    return 0
  fi
  return 1
}

# Export AZURE_DEVOPS_EXT_PAT when a token resolves. Non-zero (no-op) when none.
_ado_auth_export() {
  local tok
  tok="$(_ado_resolve_token)" || return 1
  [ -n "$tok" ] || return 1
  export AZURE_DEVOPS_EXT_PAT="$tok"
}

# ---- SOURCED MODE: just establish the auth context and return. -----------------------
# When sourced, $0 is the caller's $0, not this file; BASH_SOURCE[0] is this file.
if [ "${BASH_SOURCE[0]:-$0}" != "${0}" ]; then
  _ado_auth_export >/dev/null 2>&1 || true
  return 0 2>/dev/null || true
fi

# ---- EXECUTED MODE: CLI. -------------------------------------------------------------
set -u

_ado_usage() {
  cat <<'USAGE'
ado-auth — headless Azure DevOps auth for ado-session-sync (AAD-token-first).

  ado-auth status   show the org, its tenant, the auth mode that will be used, the
                    ambient az login, and a live probe against the org (no secret shown)
  ado-auth tenant   detect (and cache) the org's Entra tenant id
  ado-auth set      store an Azure DevOps PAT (optional fallback for PAT-allowed orgs)
  ado-auth path     print the resolved PAT-file path
  ado-auth help     this help

Default path needs no PAT: it mints a short-lived AAD token from your existing
`az login` for the org's tenant and feeds it to az devops/az boards. Be logged in
with `az login` (or `az login --tenant <id>`) to the org's tenant.
USAGE
}

_ado_org() { _ado_cfg '.ado.org'; }

# Scope-faithful probe: a work-item read (what the sync actually does), falling back
# to a project list when no project is configured.
_ado_probe() {
  local org="$1" proj
  proj="$(_ado_cfg '.ado.project')"
  if [ -n "$proj" ]; then
    az boards query --org "$org" --project "$proj" \
      --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='$proj' ORDER BY [System.Id] DESC" \
      --query "[0].id" -o tsv >/dev/null 2>&1
  else
    az devops project list --org "$org" --top 1 >/dev/null 2>&1
  fi
}

cmd="${1:-status}"
case "$cmd" in
  status)
    org="$(_ado_org)"
    printf 'ado-session-sync — auth context\n'
    printf '  org:      %s\n' "${org:-(ado.org not set in config)}"
    tid=""
    if [ -n "${org:-}" ]; then
      tid="$(_ado_org_tenant "$org" 2>/dev/null || true)"
      printf '  tenant:   %s\n' "${tid:-(undetected — set ado.tenantId or check network)}"
    fi
    if src="$(_ado_token_source)"; then
      printf '  auth:     %s\n' "$src"
    else
      printf '  auth:     none available — `az login` to the org tenant, or `ado-auth set` a PAT\n'
    fi
    if command -v az >/dev/null 2>&1; then
      who="$(az account show --query 'user.name' -o tsv 2>/dev/null)"
      atid="$(az account show --query 'tenantId' -o tsv 2>/dev/null)"
      printf '  az login: %s%s   (active subscription — not switched by this tool)\n' \
        "${who:-(not logged in)}" "${atid:+ / tenant $atid}"
    else
      printf '  az login: az not on PATH\n'
    fi
    if command -v az >/dev/null 2>&1 && [ -n "${org:-}" ] && _ado_auth_export; then
      if _ado_probe "$org"; then
        printf '  probe:    OK — authorizes %s\n' "$org"
      else
        printf '  probe:    FAILED — not authorized for %s (try: az login --tenant %s)\n' \
          "$org" "${tid:-<tenant>}"
      fi
    fi
    exit 0
    ;;
  tenant)
    org="$(_ado_org)"
    if [ -z "${org:-}" ]; then printf 'ado.org not set in config\n' >&2; exit 1; fi
    tid="$(_ado_org_tenant "$org" 2>/dev/null || true)"
    if [ -n "$tid" ]; then
      printf '%s\n' "$tid"; exit 0
    else
      printf 'Could not detect tenant for %s (check network, or set ado.tenantId)\n' "$org" >&2
      exit 1
    fi
    ;;
  set)
    pf="$(_ado_resolve_pat_file)"
    mkdir -p "$(dirname "$pf")" 2>/dev/null || { printf 'Cannot create %s\n' "$(dirname "$pf")" >&2; exit 1; }
    org="$(_ado_org)"
    printf 'Storing an Azure DevOps PAT for %s (optional fallback)\n' "${org:-the configured org}" >&2
    printf 'The default auth path needs no PAT. Use this only if your org allows PATs and\n' >&2
    printf 'you prefer one. It needs Work Items (Read & Write) scope. Create at:\n' >&2
    printf '  %s/_usersSettings/tokens\n' "${org:-<org>}" >&2
    printf 'Paste the PAT (input hidden), then Enter: ' >&2
    old_stty=""
    if [ -t 0 ]; then old_stty="$(stty -g 2>/dev/null || true)"; stty -echo 2>/dev/null || true; fi
    IFS= read -r pat || true
    [ -n "$old_stty" ] && stty "$old_stty" 2>/dev/null || true
    printf '\n' >&2
    if [ -z "${pat:-}" ]; then printf 'No PAT entered; nothing written.\n' >&2; exit 1; fi
    if [ -L "$pf" ]; then printf 'Refusing to write through symlink %s\n' "$pf" >&2; exit 1; fi
    # Create/truncate with owner-only perms BEFORE the secret is written, so the
    # PAT never lands in a pre-existing world/group-readable file.
    ( umask 077; : > "$pf" ) || { printf 'Failed to write %s\n' "$pf" >&2; exit 1; }
    chmod 600 "$pf" 2>/dev/null || true
    printf '%s\n' "$pat" > "$pf" || { printf 'Failed to write %s\n' "$pf" >&2; exit 1; }
    chmod 600 "$pf" 2>/dev/null || true
    printf 'Stored PAT in %s (chmod 600). Verifying…\n' "$pf" >&2
    if command -v az >/dev/null 2>&1 && [ -n "${org:-}" ]; then
      if AZURE_DEVOPS_EXT_PAT="$pat" _ado_probe "$org"; then
        printf 'OK — PAT authorizes %s. The session-yield sync will prefer it.\n' "$org" >&2
      else
        printf 'WARNING — could not verify against %s (check the PAT scope/expiry/org).\n' "$org" >&2
      fi
    fi
    exit 0
    ;;
  path)
    _ado_resolve_pat_file; printf '\n'; exit 0
    ;;
  -h|--help|help)
    _ado_usage; exit 0
    ;;
  *)
    printf 'Unknown command: %s\n\n' "$cmd" >&2
    _ado_usage >&2
    exit 2
    ;;
esac
