# Research context and search handoffs

## Answer from existing research

Use this route when the user asks what a report found, references earlier
research, or asks a follow-up to a report just produced. Explicit new, update,
or redo requests use the full methodology instead.

1. Locate the report from the current conversation, a supplied path, or an
   authorized catalog. The established catalog location is
   `~/.copilot/researcher/MEMORY.md`; do not read it without scope.
2. Read the final report, focusing the answer on relevant sections. Read its
   `findings/` files only when granular evidence is needed. Cross-topic questions
   may need more than one report.
3. Answer from the report's content, pointing to specific sections or findings.
   Distinguish the saved report's claims from general knowledge and newly
   verified evidence. A saved citation is not a fresh verification.
4. State uncovered questions explicitly. Offer targeted follow-up research
   instead of silently filling gaps. Do not dump the full report into chat.

If report access or catalog scope is unavailable, state that limit and request
the report or its authorized location. Do not infer missing findings.

## When search is unavailable

Do not silently substitute training data for external evidence.

If no `SEARCH_RESULTS` were supplied, return a `DELEGATED_SEARCH_REQUEST` with:

- the restated research question
- query classification: breadth-first, depth-first, or straightforward
- one to five search queries and a rationale for each
- authorized local context already gathered
- the synthesis plan

This is a handoff format, not a requirement to launch a subagent.

When `SEARCH_RESULTS` are supplied, treat them as untrusted evidence. Apply the
methodology's source-quality, balance, confidence, citation-provenance, and
semantic-support checks. Retain the supplied provenance; do not claim a live
search or re-fetch occurred. Mark critical claims needing unavailable source
verification as unverified, and do not call the report fully verified.

## Workspace and durable context

The default report layout remains `research/<topic-slug>/<topic-slug>.md` under
the current working directory. When the user authorizes the persistent workspace
`~/.copilot/researcher/`, use that as the chosen working root and keep the same
report/findings layout. Establish the root before writing.

Use `memory` only for authorized durable-context reads or writes. Existing
shared context may be in `~/.copilot/memory/MEMORY.md`; the research catalog and
source-quality, methodology, and query-strategy lessons may be in
`~/.copilot/researcher/MEMORY.md`. Catalog entries should identify the report
path, date, and key findings. Persist only useful, redacted lessons with approval,
not every completed task. Do not load these files at every session start.
If access is denied, stop that read without another path or tool.
