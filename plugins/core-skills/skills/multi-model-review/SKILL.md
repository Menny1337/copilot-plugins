---
name: multi-model-review
description: "Runs several independent critics from different model vendors over one artifact, then synthesizes their findings into a severity-ranked decision that keeps consensus and lone dissent distinct. Use when a change is high-stakes or hard to reverse, when the request asks for model diversity or genuinely independent scrutiny, or before presenting high-stakes work you authored yourself. Keywords: multi-model review, panel review, fleet review, cross-vendor critique, red-team, devil's advocate, second opinion from another model, ship-or-hold call."
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

If the critics will need context you do not yet have, run **one `explore` pass now**, before
Step 2, and fold its output into every brief. An explore agent is not a panel member: it
produces context, not findings, and nothing downstream clusters it.

### Step 2: Size the panel and pick models

| Critics | Use for | Composition |
| --- | --- | --- |
| 1 | You authored a short artifact and need one reader outside your own family | One critic, different vendor from the author |
| 2 | Light artifacts, low blast radius | Two vendors |
| **3 (default)** | Standard review | Three vendors, one critic each |
| 4–5 | High-stakes, irreversible, or security-relevant | Three vendors, plus extra critics on the riskiest lens |

Current strongest tier per vendor:

| Vendor | Model | Substitute |
| --- | --- | --- |
| Anthropic | `claude-opus-5` | `claude-opus-4.8` |
| OpenAI | `gpt-5.6-sol` | `gpt-5.6-terra` |
| Google | `gemini-3.1-pro-preview` | `gemini-3.6-flash` (lighter panels only) |

**These IDs age out; the rule behind them does not.** Take one model per vendor at the
strongest tier the `task` tool currently lists. If you authored the artifact, at least one
critic must come from a different vendor than you.

**Extra critics beyond one per vendor buy lens coverage, not consensus weight** — Step 5 counts
distinct vendors, so a second critic from a family already on the panel never converts a lone
finding into consensus.

> **The panel can collapse silently.** A rejected or misspelled `model` value may fall back to
> the orchestrator's own model, returning confident critiques that are all one family. Because
> Step 5 treats agreement as independent evidence, a collapsed panel manufactures false
> consensus. Step 5 therefore reconciles the models you requested here against what `read_agent`
> reports, before counting anything.

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

- `id` — `<prefix>/F1`, `<prefix>/F2`. **Assign the prefix yourself in the brief** (`A/`, `B/`,
  `C/`). Do not tell critics to derive it from their own vendor: they mis-identify themselves,
  and two critics that both believe they are OpenAI will both emit `OpenAI/F1`, reintroducing
  the collision the namespacing exists to prevent.
- `dimension` — which of the five rubric items above.
- `class` — `objective` / `structural` / `subjective`.
- `severity` — `blocker` / `major` / `minor`.
- `claim` — the issue in one sentence.
- `evidence` — a quote or precise pointer (`file:line`, section).
- `fix` — the concrete change, or what would prove the finding wrong.

Close with one line: `VERDICT: ship` / `hold` / `needs-rework`.

**Rewrite lenses are exempt from the finding shape, the rubric, and Steps 5–7.** If the
assignment is to rewrite rather than to judge — tighten this text, sharpen this description —
the output contract is the rewritten text plus what changed and why, and the lens's own criteria
replace the five dimensions. Such a run **exits after this step**: deliver the rewrite and the
rationale. Clustering, agreement labelling, and the decision table have nothing to operate on,
and routing a rewrite through them lands it on Hold for want of a matching row.

Tell critics to **argue against the artifact, not validate it**. The characteristic failure of
a review panel is N models politely agreeing.

**Tell critics they are read-only.** A critic given a working tree will use it — writing
before/after copies, scratch notes, or extracted snippets next to the files it is reviewing. Those
land in the change set under review and can be committed by accident. State the constraint
explicitly ("do not write any files; read only"), and check `git status` for strays before
committing.

**Launch all critics in one response so they run concurrently.** Prefer **sync** `task` calls:
they return in-band, so a partial panel is structurally impossible and no waiting protocol is
needed. Use background mode only when you have real independent work to do meanwhile — then
collect each with `read_agent` (`wait: true`), re-issuing if it times out, and use `write_agent`
to push back on a thin critique instead of launching a replacement.

**Never launch and end the turn in a non-interactive run** (`copilot -p`, scheduled jobs): the
process exits, the critics' output is discarded, and nothing is ever synthesized.

**Write each critique to the session workspace as it returns**, then synthesize from those files.
Raw critiques are bulky and Step 5 needs all of them at once; persisting them means a context
trim cannot silently shorten your action list, and it leaves an auditable trail.

### Step 5: Synthesize — judgment stays with the orchestrator

**Do not delegate synthesis to a sub-agent.** A stateless aggregator sits upstream of the
panel's highest-value output — the lone-dissent findings — and can quietly drop them. You also
need the raw critiques in context to adjudicate and answer follow-ups.

**Wait for every launched critic to return.** Synthesis over whoever happened to reply is the
most dangerous state in this skill: it labels findings against a panel you did not run. A 2-of-3
return silently demotes CONSENSUS clusters to LONE-DISSENT; a 1-of-3 return trips the
single-critic branch and produces a thin, clean-looking pass. If a critic fails or times out,
relaunch it, or recompute N and state the reduced panel explicitly — never report the planned N.

**Then verify the panel — from your own records, not the critics' claims.** Compare the models
you requested in Step 2 against the model each agent actually ran on — both `read_agent` and
`list_agents` report it. Note the vendor set you actually got. If it is smaller than planned, say so explicitly rather than
reporting the agreement you intended to buy: with more than one critic, two critics on one
vendor count as one voice, and a panel that collapsed onto a single vendor should be relaunched
rather than reported as consensus. A single-critic panel is not a collapse — it has no agreement
to inflate; verify only that the critic differs in vendor from the artifact's author.

> **Do not ask critics to self-report their model** — they get it wrong. In testing, a critic
> running on `gemini-3.1-pro-preview` reported itself as `gpt-4o / OpenAI`, which would have
> faked a vendor collapse that had not happened. Your launch records are authoritative. Genuine
> server-side substitution is not observable from inside the session, so treat vendor diversity
> as requested and recorded, not proven.

Then:

1. **Cluster** findings that are the same issue raised by different critics, and give each
   cluster a stable id (`C1`, `C2`). Clustering is inherently cross-critic — no critic sees
   the others — so it cannot move upstream into Step 4. A deterministic similarity pass may
   *propose* clusters for you to confirm; never hand the decision to an LLM sub-agent.
2. **Classify** each cluster as `objective`, `structural`, or `subjective`.

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
4. **Rank** by severity first, then by label (CONSENSUS above LONE-DISSENT above UNCORROBORATED),
   then objective before structural before subjective.
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

Present the synthesized action list — not the raw transcripts, which can be linked or
appended. Each item carries: cluster id, finding, severity, class, agreement label, the evidence
pointer, and the next step.

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
| A blocker has survived two rounds | **Escalate to the user** with both positions — do not loop |
| Three rounds reached and blockers or majors are still open | **Escalate.** The cap ends the iteration; it does not clear the findings |
| Any blocker or major is still open | **Hold** — state exactly what must change before a re-run |
| Critics contradict on fix direction, with nothing blocking left | Adjudicate, state the tradeoff, record the chosen direction — then **Ship**. More rounds will not resolve taste |
| No open blockers or majors, and the Step 1 done-criteria are satisfied | **Ship** — list any remaining subjective items as notes |
| Any other state | **Hold** — report the action list and state what must change |

Ordering is load-bearing: the open-blocker row sits above the adjudication and ship rows so that
a disagreement about *how* to fix something can never route around the fact that something is
still broken. And because this skill does not remediate, "ship" here means *this review raises
no further objection* — the fix itself happens outside, and a round cap is a stopping rule, not
an approval.

**Re-invoking.** Round N+1 is warranted once the artifact has actually changed in a section a
finding cited — carry the cluster table forward so surviving blockers stay identifiable, since
fresh critics renumber from scratch. Re-running an unchanged artifact against the same panel
reproduces the same critiques at full cost.

## Notes

- **Parallel implementation review.** When the panel reviews a code change, each model can
  work in its own branch and worktree to avoid collisions. That fan-out belongs outside this
  skill, which owns only the critique-and-synthesize loop. Pause before any commit or push per
  repository rules.
- **A panel does not launder responsibility.** Unanimity is evidence, not proof. Where the panel
  agrees and the stakes are high, the residual risk is precisely what none of them was trained
  to see.
