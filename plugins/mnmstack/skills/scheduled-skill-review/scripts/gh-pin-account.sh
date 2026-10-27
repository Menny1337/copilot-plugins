# shellcheck shell=bash
# gh-pin-account.sh — pin the gh CLI to the repo-owner account for the current
# process, WITHOUT changing the user's global active gh account.
#
# Why this exists: gh keeps a single *global* active account, independent of
# git's credential helper. A stray `gh auth switch` (e.g. to a work account)
# makes every gh API call — `gh pr create`, `gh pr view`, reconcile — fail with
#
#     GraphQL: Could not resolve to a Repository with the name '<owner>/<repo>'.
#
# even though `git push` still works (separate credentials). The visible symptom
# is review branches that upload but never open a PR. We resolve the owner's
# stored token once and export GH_TOKEN: gh then uses that token regardless of
# the active account, and the user's global selection is left untouched.
#
# Contract: source this file, then call `pin_gh_account`. The caller must provide
#   - REPO_DIR     absolute path to the git working tree
#   - REMOTE_NAME  git remote to read the owner from (defaults to "origin")
#   - log          a logging function (message -> stderr/daemon.log)
#   - GH_ACCOUNT   optional explicit owner override (else parsed from the remote)
# It no-ops cleanly (returns 0) when gh is absent, the current account/token
# already resolves the repo, or no owner/token can be determined — callers then
# degrade exactly as they did before this helper existed.

pin_gh_account() {
  command -v gh >/dev/null 2>&1 || return 0

  # If the current account/token already resolves the repo, there is nothing to
  # do (also true when a parent process already exported GH_TOKEN for us).
  if ( cd "$REPO_DIR" && gh repo view --json nameWithOwner >/dev/null 2>&1 ); then
    return 0
  fi

  local owner token
  owner="${GH_ACCOUNT:-}"
  if [ -z "$owner" ]; then
    # Parse "<owner>" from git@host:owner/repo.git, ssh://host/owner/repo, or
    # https://host/owner/repo.git — strip the scheme/host, the trailing .git,
    # then everything from the first slash on.
    owner="$(git -C "$REPO_DIR" remote get-url "${REMOTE_NAME:-origin}" 2>/dev/null \
      | sed -E 's#^(git@[^:]+:|ssh://[^/]+/|https?://[^/]+/)##; s#\.git$##; s#/.*$##')"
  fi
  if [ -z "$owner" ]; then
    log "gh: active account cannot resolve the repo and no owner could be derived from remote '${REMOTE_NAME:-origin}' — PR/reconcile steps may fail"
    return 0
  fi

  token="$(gh auth token --user "$owner" 2>/dev/null || true)"
  if [ -z "$token" ]; then
    log "gh: active account cannot resolve the repo and no stored token for '$owner' (run: gh auth login --user $owner) — PR/reconcile steps may fail"
    return 0
  fi

  export GH_TOKEN="$token"
  if ( cd "$REPO_DIR" && gh repo view --json nameWithOwner >/dev/null 2>&1 ); then
    log "gh: pinned to account '$owner' for this run (global active account unchanged)"
  else
    log "gh: still cannot resolve the repo after pinning to '$owner' — PR/reconcile steps may fail"
  fi
}
