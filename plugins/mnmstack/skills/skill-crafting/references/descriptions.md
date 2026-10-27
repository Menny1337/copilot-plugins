# Description design

Read for a new or changed skill description. The description should identify
the task that benefits from the skill, including the nearest likely confusion.
Do not assume that undertriggering is more common than overtriggering.

## Draft the boundary

Use a short third-person capability statement and a concrete use condition.
Put distinctive task words early. Add a synonym only when it covers a real
way to request the same work. Quote the single-line YAML value.

The portable description limit is 1,024 characters, not a target length.
Do not fill a word budget or append a keyword list by default. A host may use
semantic retrieval; exact keyword overlap is not the only discovery signal.

Example of an overly broad description:

```yaml
description: "Builds dashboards. Use whenever metrics, company data, charts, or analytics are mentioned."
```

A scoped alternative:

```yaml
description: "Builds interactive data dashboards. Use when creating or revising a dashboard from supplied data."
```

"Explain what this KPI means" is a near-miss, not a dashboard-building request.
"Turn this sales table into a dashboard" is a positive case. Test both;
neither description's wording alone proves that routing works.

Keep use/skip sections in the body for concise clarifications and redirects.
They should not repeat the entire description or broaden its trigger.

## Required independent critique

For every new or changed description, invoke `multi-model-review` in rewrite
mode with one critic from a different vendor than the author. Pass the exact
draft, the skill's purpose, and these four cut-tests:

1. Remove implementation details that do not help discovery.
2. Remove repetition between the lead and the trigger conditions.
3. Collapse synonyms that do not cover a distinct request.
4. Remove words that do not change scope or comprehension.

The critic returns a proposed rewrite and explains its changes. This is a
rewrite-only run, not one lens inside a judging panel. You retain responsibility
for the final boundary; reject cuts that lose legitimate tasks and additions
that widen scope. If no cross-vendor critic is available, self-review and record
the missing independence. Do not label that fallback independent or use it to
bypass a stricter invoking workflow's required review.

## Check the result

For a routing change, use at least two should-trigger prompts and two
semantically close near-misses. Compare with the previous description when one
exists. Include requests that should use another skill or no skill.

Check the description alongside its nearest neighbours and the actual body.
A concise claim that promises work the procedure cannot do is still wrong.
Do not report a reviewer opinion as a runtime trigger test.

For session-backed tuning, use `skill-improvement-loop`: confirm the actual
failure mode before adding synonyms or narrowing scope. Keep its evidence
thresholds and approval rules.
