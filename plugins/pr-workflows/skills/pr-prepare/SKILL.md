---
name: pr-prepare
description: "Assesses local changes for publication and, when authorized, publishes a new PR or refreshes an existing one for human review, including target integration and conflict resolution. Not for merging."
---

# PR prepare

## When to Use

Assess local work for publication or bring an existing Azure DevOps or GitHub
PR up to date for human review.

## When to Skip

- A read-only status question: use `pr-status`.
- Evidence-heavy behavioral verification: use `pr-validate`.
- Continuous shepherding through green CI and approval: use `pr-watch`.
  Do not repeatedly update a watched PR just because base moved.

## Procedure

1. Identify whether this is an assessment, branch preparation, or authorized
   publication. "Anything to commit or create a PR for?" is an assessment,
   not permission to commit. "Ready for approval" does not authorize merge.
   Preserve explicit review stops and separate grants for commit, push, and
   PR creation. Ask if a necessary publication grant is missing.
2. Read repository guidance, status, worktree ownership, and the complete
   relevant diff. Separate this task's changes from unrelated work, generated
   artifacts, and secrets. Never stage everything blindly or switch a shared
   checkout away from another session's branch.
3. Resolve the real target from live PR metadata or established repository
   context. Do not guess `main` versus `master`. Fetch the target when branch
   preparation is requested. For a read-only assessment, compare available
   refs and disclose stale or missing remote evidence.
4. Compare intended changes with the latest target. Identify work already
   upstream or no longer needed before proposing a PR. Keep only the requested
   scope; ask before splitting or discarding existing work.
5. Use a suitable unowned PR worktree or an isolated worktree when editing.
   If creating one, follow machine placement conventions:
   `<repo-parent>/<repo-name>-worktrees/<branch-slug>/`. Do not create another
   full clone of an existing local repository.
6. For an authorized refresh, follow repository policy. On a published ADO PR,
   prefer merging the fetched target without rewriting history. If repository
   policy prohibits that strategy, stop and agree on a supported alternative;
   do not silently rebase or force-push. Resolve conflicts
   by preserving both sides' intended behavior; ask about irreconcilable product
   decisions. Never rewrite pushed history without explicit authorization.
7. Run focused checks for the resulting diff, including relevant checks after
   conflict resolution. Restore dependencies only when manifests changed or a
   chosen check reports missing dependencies. Keep failures and limitations
   explicit; do not weaken checks to get ready.
8. Commit only when committing is authorized, using the owned scope, repository
   conventions, and required co-author trailer. Before a separately authorized
   push, verify the live source head has not changed. Reconcile concurrent
   changes rather than overwriting them. Create a PR only when PR creation is
   authorized. Use the app's PR creation tool for supported GitHub session PRs; for ADO,
   use available provider tooling. Preserve the confirmed target and draft
   choice, and never silently enable auto-complete.

Report what remains local, committed, pushed, and opened as a PR, with the PR
link when available. After publication, read current policies once and separate
passing, pending, failing, and unknown. Ready for human review is not merged,
fully validated, or deployed. Do not start a watcher or merge.
