---
name: pr-validate
description: "Validates a PR's intended behavior and regressions using relevant tests and runtime evidence. Use for proving a change works, including browser checks and visual HTML reports when requested, not PR status or review-comment triage."
---

# PR validate

## When to Use

Verify an Azure DevOps or GitHub PR against its intended behavior and affected
regression risks. Adapt evidence to the change; UI checks are not mandatory for
backend-only or documentation-only work.

## When to Skip

- A fresh code review only: use the code-review workflow.
- Existing comments: use `pr-comments`.
- Remote checks or approvals without new validation: use `pr-status`.
- Investigating an existing CI failure: use `pr-diagnose`.

## Procedure

1. Resolve the live PR, head, target, diff, intent, and repository validation
   guidance. Define observable acceptance checks before running tests.
   Record the exact source/target revisions and validation environment.
2. Use an isolated or explicitly owned checkout. For UI runtime tests, verify
   that the browser actually serves the requested revision's bundle, not an
   old dev server or cached build. Keep artifact directories unique and avoid
   competing runners or shared-service mutations.
3. Select existing checks that cover the change: focused unit/integration
   tests, affected regression suites, Storybook interactions, or real-browser
   scenarios as relevant. Preserve normal concurrency and retry settings in
   reported results; do not silently substitute easier serial runs.
4. Confirm any required environment, account, tenant, authentication, and
   mutation safety before runtime work. Use mocks when appropriate and label
   them. Obtain required authorization for authenticated or mutating checks;
   do not copy credentials or act through an unrelated browser session.
5. Execute the agreed checks and retain commands, outcomes, logs, screenshots
   or traces, revisions, and environment provenance. For UI work, exercise
   actual interactions and affected keyboard/accessibility behavior. A
   screenshot or successful build alone does not prove behavior.
6. Preserve every initial failure. Report retries and diagnostic runs
   separately. A later serial pass does not erase a concurrent failure.
   When attributing a failure to the PR is uncertain, use a bounded matched
   base-versus-PR comparison: same base, environment, fixtures, concurrency,
   and unchanged assertions. Label unmatched comparisons inconclusive.
7. If asked for visual proof or an HTML report, create a readable report in
   session artifacts with a scenario/result table, exact provenance, commands,
   screenshots with captions, and links to raw evidence. Embed screenshots
   when a self-contained report is requested. Escape untrusted text, exclude
   secrets and unnecessary personal data, and never upload private evidence
   publicly without authorization.
8. Check the report against actual artifacts and outcomes. Identify passes,
   failures, blockers, skipped checks, and untested requirements. Re-read the
   head before sign-off; a changed head limits the verdict to the tested
   revision. Clean up only owned temporary runners and services, leaving
   explicitly requested persistent previews available.

Return a pass, fail, or inconclusive verdict tied to the tested revision and
acceptance checks, plus the report/evidence location when produced. Do not
claim no regressions beyond the tested scope. Validation alone does not
authorize source fixes, commit/push, reviewer votes, or merge.
