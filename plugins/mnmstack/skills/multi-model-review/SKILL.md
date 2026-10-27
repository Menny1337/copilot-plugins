---
name: multi-model-review
description: "Runs independent critics from different model vendors over one artifact, then synthesizes their findings into a ship-or-hold decision. Use for high-stakes or hard-to-reverse work, panel or fleet reviews, red-team passes, and second opinions from another model."
argument-hint: "<artifact path or description>"
---

# Multi-Model Review Panel

Critique one artifact from several independent vantage points, then adjudicate the results
into a single ranked action list.

Two things make this worth the cost. **Diversity**: model families share training data and
therefore share blind spots, so an author model rarely catches its own — which is why panel
composition is counted in distinct vendors throughout, never in raw agent count. **Synthesis**:
N raw critiques are not a decision until someone clusters them, weighs agreement against
isolated insight, and resolves the contradictions.

Critics run in **fresh context** — a stateless sub-agent that cannot see this conversation, and
so cannot inherit the reasoning that produced the artifact.

## When to Use

- The user asks for multiple models, a panel, a fleet review, cross-vendor scrutiny, or an
  explicitly independent second opinion.
- You authored the artifact and want it read by something outside your own family before you
  present it.
- A high-stakes deliverable is about to ship — a decision memo, a baseline, a structural
  refactor — and one reviewer is not enough confidence.

## When to Skip

- **You did not author the artifact and one specialist pass answers the question** — call
  `task` once with `code-review`, `rubber-duck`, or `security-review`. This covers routine
  security sweeps; a security-relevant *high-stakes* change still takes a full panel.
- **The job is to make the change, not judge it** — do the work, then review. (Reviewing your
  own finished output is in scope, and is what a rewrite lens at panel size 1 is for.)
- **The artifact is trivial and nobody depends on it, or the question is a lookup** — answer it
  directly. Size alone does not decide this: a one-line skill `description` is small and
  high-leverage, and warrants a single cross-vendor rewrite pass.
- **The task needs external sources or citations** — use `research-methodology`. Use this
  skill only to panel-review the report it produces.

## Procedure

Steps 1–6 produce and deliver a decision. Step 7 decides what happens next. **This skill
judges; it does not remediate.** Applying fixes happens outside it — re-invoke as round N+1
after the artifact actually changes.

### Step 1: Define the review contract

- **Target** — exact artifact path(s). Give critics the real file, never your summary of it;
  a summary launders your own blind spots into every critique. Where the artifact is not yet on
  disk — an unsaved draft, a proposed wording — paste the exact text verbatim plus its purpose.
- **Lens** — what each critic scrutinizes. See Step 3.
- **Done-criteria** — what the synthesis must answer: "ship or hold", "top three risks",
  "is claim X defensible". Step 7 tests against this, so make it checkable.
- **Round** — current round number and surviving cluster ids from the prior round. Use round 1
  when no prior synthesis exists.

If the critics need context beyond the artifact, collect it before Step 2 and give every critic
the same source paths and verified facts. Do not give them an `explore` agent's interpretation:
shared conclusions bias the panel before it starts. An `explore` agent is not a panel member,
and its output never counts as a finding.

### Step 2: Size the panel and pick models

| Critics | Use for | Composition |
| --- | --- | --- |
| 1 | You authored a short artifact and need one reader outside your own family | One critic, different vendor from the author |
| 2 | Light artifacts, low blast radius | Two vendors |
| **3 (default)** | Standard review | Three vendors, one critic each |
| 4–5 | High-stakes, irreversible, or security-relevant | Four or five vendors when available; duplicate a vendor only after distinct vendors are exhausted |

Before every launch, read the exact `model` and `agent_type` values in the current `task` tool
declaration. The live declaration is authoritative; this dated table is a convenience, not an
allowlist.

Preferred fixed models currently available per vendor (verified 2026-09-02):

| Vendor | Preferred | Example same-vendor alternatives |
| --- | --- | --- |
| OpenAI | `gpt-5.6-sol` | `gpt-5.6-terra`, `gpt-5.6-luna` |
| Google | `gemini-3.7-flash` | `gemini-3.6-flash` |
| xAI | `grok-4.6` | `grok-4.5` |
| Microsoft | `mai-code-1.1-flash` | — |
| Anthropic | `claude-opus-5` | `claude-sonnet-5`, `claude-opus-4.8` |

Use this selection order:

1. Validate every candidate against the live declaration before planning the panel. Never
   launch an ID from the dated table unless it is still listed.
2. Group live fixed-model IDs by vendor: `gpt-*` = OpenAI, `claude-*` = Anthropic,
   `gemini-*` = Google, `grok-*` = xAI, and `mai-*` = Microsoft. Treat an unmatched prefix as
   unknown; count it only when the live tool metadata identifies a vendor.
3. Choose the strongest suitable model from distinct vendors before adding a second critic from
   any vendor. If you authored the artifact, panel size 1 must use a different vendor. Determine
   the author's vendor from host/session metadata; when it is unknown, use at least two vendors.
4. Pass an explicit live `model` ID on every critic call. Never launch selector or router IDs
   such as `*-picker` as critics or substitutes.
5. If a model or agent type is rejected, that critic is missing. Choose a same-vendor alternative,
   then another distinct vendor, or reduce the panel and report the reduction. Never count a
   failed launch.
6. Check the chosen model's declared capabilities before passing `reasoning_effort` or
   `context_tier`. Prefer high effort for substantive reviews and long context when needed, but
   omit unsupported parameters or choose another model. On a parameter rejection, retry once
   with supported values before treating the critic as missing.

Extra same-vendor critics buy lens coverage, not consensus weight: Step 5 counts distinct
vendors, so another critic from an already represented family never turns a lone finding into
consensus.

> **A missing or substituted model can collapse the panel.** Keep a launch record of requested
> model, vendor, agent type, mode, lens, critic prefix, accepted parameters, and substitutions;
> reconcile every returned critique against it before counting agreement. The alternatives above
> are examples, not a closed fallback pool; any suitable live fixed model from that vendor may be
> used.

### Step 3: Assign lenses

A **lens** is the *area* a critic examines — correctness, security, extraction fidelity,
usability. A **dimension** is one of the five rubric items in Step 4, and every critic applies
all five *within its lens*. Splitting lenses divides the artifact; it never divides the rubric.

| Lens | `agent_type` |
| --- | --- |
| Correctness, logic, hidden assumptions | `rubber-duck` |
| Code change or PR quality — **needs an existing diff**; for a whole or new file use `general-purpose` | `code-review` |
| Security vulnerabilities | `security-review` |
| Structure, information architecture, usability, soundness | `general-purpose` |
| Rewrite or text tightening | `general-purpose`; use the rewrite exception in Step 4 |

**Default to split lenses.** Choose shared only when the question is itself "do independent
reviewers agree?" — split buys coverage, which is what a panel is usually for.

- **Split lenses** — each critic gets a different area. Maximises coverage. Because only one
  critic examines each area, findings there cannot be corroborated; Step 5 labels them
  UNCORROBORATED rather than discarding them.
- **Shared lens** — every critic gets the same area. Measures agreement directly; disagreement
  becomes the informative signal.

Say which mode you chose.

### Step 4: Brief every critic to the same contract

Briefs must be identical in output contract, class definitions, rubric, and background context.
**The lens is the only permitted variation.**

Sub-agents are stateless and cannot see your conversation, so each brief must be
self-contained: artifact path(s), the lens, the rubric, the class definitions, the output
contract, and enough context to judge the artifact against its actual goal.

**Rubric — all five dimensions, always, applied within the critic's lens.** Do not hand one
dimension to each critic: with five dimensions and a three-critic default the arithmetic leaves
dimensions unexamined, and it turns the Step 5 agreement signal into an artefact of the brief.
Tell each critic not to stray outside its lens.

1. **Correctness** — what is wrong, unsupported, or logically broken.
2. **Gaps** — what is missing, unhandled, or assumed without basis.
3. **Risks** — what could fail, and who is affected.
4. **Contradictions** — internal inconsistencies, or conflicts with stated constraints.
5. **Falsification** — the most likely reason this is wrong, and what evidence would disprove it.

**Class definitions — copy these into every brief.** Critics cannot see Step 5, and class drives
how a finding is ranked and adjudicated, so a critic left to invent the taxonomy is filing
findings under a scheme nothing downstream understands.

| Class | What it means |
| --- | --- |
| `objective` | Verifiable true or false against the artifact: broken reference, wrong figure, invalid ID, contradiction with a cited source, security hole |
| `structural` | Reasoned but contestable: architecture, sequencing, narrative, completeness |
| `subjective` | Tone, density, style, preference |

**Output contract.** Every critic emits findings in a fixed shape so that synthesis is grouping
rather than parsing:

- `id` — `A/F1`, `A/F2`, and so on. **Assign a bare prefix yourself in the brief** (`A`, `B`,
  `C`). Do not tell critics to derive it from their own vendor: they mis-identify themselves,
  and two critics that both believe they are OpenAI will both emit `OpenAI/F1`, reintroducing
  the collision the namespacing exists to prevent.
- `dimension` — which of the five rubric items above.
- `class` — `objective` / `structural` / `subjective`.
- `severity` — `blocker` / `major` / `minor`.
- `claim` — the issue in one sentence.
- `evidence` — a quote or precise pointer (`file:line`, section).
- `fix` — the concrete change, or what would prove the finding wrong.

Close with one line: `VERDICT: ship` / `hold` / `needs-rework`.

**Rewrite is a whole-run mode, never one lens in a mixed judging panel.** When the assignment is
to rewrite rather than judge — tighten this text, sharpen this description — every critic uses a
rewrite contract: rewritten text plus what changed and why. The run exits after this step because
the finding rubric and Steps 5–7 do not apply.

Tell critics to **argue against the artifact, not validate it**. The characteristic failure of
a review panel is N models politely agreeing.

**Tell critics they are read-only.** A critic given a working tree will use it — writing
before/after copies, scratch notes, or extracted snippets next to the files it is reviewing. Those
land in the change set under review and can be committed by accident. State the constraint
explicitly ("do not write files or launch sub-agents; critique directly"), and verify the working
directory for strays before finishing (`git status` when it is a Git repository).

**Launch all critics in one response so they run concurrently.** Prefer **sync** `task` calls:
they return in-band and make result accounting straightforward. Individual calls can still fail,
so require one contract-valid result per launch: every required finding field plus a verdict, or
an explicit empty finding list plus a verdict. Use background mode only when you have real
independent work to do meanwhile; collect every result with `read_agent` before synthesis. If a
critique is missing, malformed, or unusably thin, relaunch the same brief in fresh context rather
than coaching the original critic with follow-up messages.

**Never launch and end the turn in a non-interactive run** (`copilot -p`, scheduled jobs): the
process exits, the critics' output is discarded, and nothing is ever synthesized.

**Persist each critique outside the reviewed repository** as it returns, using the host-provided
session workspace or structured session storage rather than assuming the current directory is
safe. Raw critiques are bulky and Step 5 needs all of them at once; persistence prevents a
context trim from silently shortening the action list and leaves an auditable trail.

### Step 5: Synthesize — judgment stays with the orchestrator

**Do not delegate synthesis to a sub-agent.** A stateless aggregator sits upstream of the
panel's highest-value output — the lone-dissent findings — and can quietly drop them. You also
need the raw critiques in context to adjudicate and answer follow-ups.

**Wait for every launched critic to return.** Synthesis over whoever happened to reply is the
most dangerous state in this skill: it labels findings against a panel you did not run. A 2-of-3
return silently demotes CONSENSUS clusters to LONE-DISSENT; a 1-of-3 return trips the
single-critic branch and produces a thin, clean-looking pass. If a critic fails or times out,
relaunch it, or recompute N and state the reduced panel explicitly — never report the planned N.

**Then verify the panel from the launch record, not the critics' claims.** Require one usable
result for every planned critic and confirm that every request used a live fixed-model ID and
the recorded vendor set. When the runtime exposes actual model metadata, compare it with the
request; if it does not, report diversity as requested and recorded, not proven. A mismatch,
missing result, or smaller vendor set invalidates the planned panel: relaunch, or explicitly
recompute N and the vendor set before clustering. With more than one critic, two critics from
one vendor count as one voice; a panel reduced to one vendor cannot report consensus. Do not
synthesize or decide while the panel is invalid. If it cannot be reconciled to the Step 1
done-criteria, hold and report the failed panel rather than issuing a review verdict.

> **Do not ask critics to self-report their model** — they get it wrong. In testing, a critic
> from one vendor reported itself as a model from another, which would have faked a vendor
> collapse that had not happened. Your launch records and any host-reported metadata are
> authoritative. Genuine server-side substitution may be unobservable, so distinguish requested
> diversity from verified diversity.

Then:

1. **Cluster** findings that are the same issue raised by different critics, and give each
   cluster a stable id (`C1`, `C2`). Clustering is inherently cross-critic — no critic sees
   the others — so it cannot move upstream into Step 4. A deterministic similarity pass may
   *propose* clusters for you to confirm; never hand the decision to an LLM sub-agent.
2. **Classify** each cluster as `objective`, `structural`, or `subjective`. Set cluster severity
   to the highest credible member severity; lower it only when the higher rating fails the
   evidence check below.

**Agreement ranks findings. It never removes them.** Reviewing this skill produced the same
defect in three consecutive rounds — first at panel size 1, then in split-lens mode, then for
lone-dissent structural findings — every time because agreement was used as a gate on what
entered the action list, and every time the result was a confident, empty pass. The gate is
gone. Keep every credible finding, record how well corroborated it is, and let severity and
corroboration drive the order.

| Label | Meaning |
| --- | --- |
| **CONSENSUS** | Two or more distinct vendors raised it |
| **LONE-DISSENT** | One vendor raised it; others examined the same area and did not |
| **UNCORROBORATED** | One vendor raised it; nobody else examined that area |

Keep the last two visible and distinct: dissent means the panel disagreed, uncorroborated means
the panel never looked. Drop a finding only when it is not credible — unsupported by its own
stated evidence, or contradicted by the artifact. "Only one model said it" is never a reason to
drop anything; one model catching the real defect is the panel's highest-value output, and
requiring a vote on it is the most expensive mistake available in this step.

3. **Label** each cluster CONSENSUS, LONE-DISSENT, or UNCORROBORATED per the table above.
4. **Rank** by severity first, then class (objective before structural before subjective), then
   label (CONSENSUS above UNCORROBORATED above LONE-DISSENT). An unexamined finding carries
   uncertainty; a dissenting finding carries contrary evidence, but both remain visible.
5. **Resolve** direct disagreements explicitly: state both positions and your adjudication
   with reasoning, rather than silently picking one. Where critics in a cluster assigned
   different classes, your classification governs — keep `objective` whenever the cited evidence
   is independently checkable against the artifact, and demote to `structural` only where a
   critic asserted objectivity without checkable evidence.

**At panel size 1** there is nothing to corroborate: skip clustering (1) and resolution (5),
which need a second critic, and label every finding UNCORROBORATED. Still assign stable ids
(`C1`, `C2`) so a later round can tell which findings survived.

**Verify before you accept.** Critics state runtime facts with total confidence and are
sometimes wrong: in testing, one declared a tool unavailable that was in active use, and another
claimed a tool did not return a field it does return. Check any objective claim you can check
cheaply — a `grep`, a file read, one tool call — before it reaches the action list.

> **Escape hatch.** Delegate mechanical aggregation only under genuine context pressure — long
> critiques you cannot hold at once, nested panels, or an observed case of findings being
> dropped. Gauge it by volume, not critic count: three long critiques outweigh eight terse ones.
> Even then prefer a deterministic clustering script, and return final judgment here.

### Step 6: Report

Present the synthesized action list — not the raw transcripts, which can be linked or appended.
Include the round, planned and delivered vendor set, and verification status. Each item carries:
cluster id, finding, severity, class, agreement label, the evidence pointer, and the next step.

**Cap the render.** Blockers and majors in full; minors collapsed to a count plus a pointer to
the saved synthesis. Lead with whatever the Step 1 done-criteria asked for. A twenty-cluster wall
of seven-field entries is not a decision aid — the user stops reading, and the review's value
goes with them.

**Compute Step 7 before you render, then put the findings above the call it produced.** "Report
before deciding" governs what the *user* reads first, not whether you have done the arithmetic:
nobody can weigh a ship-or-hold call against findings they have not seen, and a verdict stated
before the table is run is a guess.

Save the full synthesis to the session workspace — never inside the reviewed artifact's
repository, where it becomes a stray in the very change set under review.

### Step 7: Decide

Evaluate top to bottom; **first match wins**.

| Condition | Action |
| --- | --- |
| The panel is incomplete or unreconciled against Step 1 | **Hold** — report the failed launches or missing vendor coverage; do not synthesize a review verdict |
| A blocker has survived two rounds | **Escalate to the user** with both positions — do not loop |
| Three rounds reached and blockers or majors are still open | **Escalate.** The cap ends the iteration; it does not clear the findings |
| Any blocker or major is still open | **Hold** — state exactly what must change before a re-run |
| No blockers or majors remain, the Step 1 done-criteria are satisfied, but critics contradict on fix direction | Adjudicate, state the tradeoff, record the chosen direction — then **Ship**. More rounds will not resolve taste |
| No open blockers or majors, and the Step 1 done-criteria are satisfied | **Ship** — list any remaining minor findings as notes |
| Any other state | **Hold** — report the action list and state what must change |

Ordering is load-bearing: the open-blocker row sits above the adjudication and ship rows so that
a disagreement about *how* to fix something can never route around the fact that something is
still broken. And because this skill does not remediate, "ship" here means *this review raises
no further objection* — the fix itself happens outside, and a round cap is a stopping rule, not
an approval.

**Re-invoking.** Round N+1 is warranted once the artifact has actually changed in a section a
finding cited — carry the cluster table forward so surviving blockers stay identifiable, since
fresh critics renumber from scratch. Match survivors by normalized claim and evidence pointer,
not critic or cluster number. Re-running an unchanged artifact against the same panel reproduces
the same critiques at full cost.

## Notes

- **Parallel implementation review.** When the panel reviews a code change, each model can
  work in its own branch and worktree to avoid collisions. That fan-out belongs outside this
  skill, which owns only the critique-and-synthesize loop. Pause before any commit or push per
  repository rules.
- **A panel does not launder responsibility.** Unanimity is evidence, not proof. Where the panel
  agrees and the stakes are high, the residual risk is precisely what none of them was trained
  to see.
