# Agent/skill change log

Keep one entry per unit, root-cause layer, and patch. Store it outside the
reviewed unit in an authorized `~/.copilot/memory/skill-improvement-loop.md`
or repo-local reviewed file. Use redacted summaries and private evidence
pointers; never store raw prompts, secrets, customer data, or proprietary code.
Follow the [shared outcome contract](../../skill-crafting/references/evaluation.md#verify-task-completion).

```markdown
### <YYYY-MM-DD>: <unit>

- Status: open | closed
- Target: agent | skill; `<plugin>/agents/<name>` | `<plugin>/skills/<name>`
- Signal: <failure, hits/relevant sessions>
- Evidence: direct | strong-inferred | weak-inferred; <private pointers>
- Coverage: <source availability, dates, repo, scanned/relevant counts>
- Layer: discovery | procedure | agent-orchestration | tool/platform | structural
- Hypothesis/patch: <one edit, expected effect and metric>
- Authority: <named human/date, or explicit scheduled AUTO-DEPLOY/AUTO-REVERT authorization>
- Applied/validation: <yes/no, date, revision, passed/failed checks>
- deployed_at: <actual plugins-update time; pending if not live>
- Comparison: <same-case baseline/held-out IDs, critical attempts, conditions>
- Outcome readback: <expected artifact/state, evidence, forbidden actions>
- Baseline: <window, failures/denominator, outcome statuses>
- Confounders: <model/version, agent, repo/other edits, task mix, coverage>
- Review due: <YYYY-MM-DD>

#### Re-review <date>
- Post-deploy: <window, samples, failures/denominator, comparable conditions>
- Verified outcomes: <pass/fail/partial/blocked/not-run counts; missing evidence unknown>
- Regressions/overhead: <case failures, violations, time/handoffs, available tokens/cost>
- Confounders observed: <details>
- Verdict: consistent-with-improvement | no-clear-change | possible-regression | insufficient-evidence | invalid-hypothesis
- Action: keep | revert | follow-up (new cycle) | extend window; <authority/new due date>
- Lesson: <authorized redacted memory path/summary, or none>
```
