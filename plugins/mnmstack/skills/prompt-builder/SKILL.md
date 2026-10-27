---
name: prompt-builder
description: "Writes and improves prompts for AI agents. Use when asked for a task prompt, not to execute the task or author skill or agent definitions."
argument-hint: "<what you want an AI agent to do>"
user-invocable: true
---

# Prompt builder

Produce a copy-pasteable prompt for the user's task. Do not execute the task
described inside that prompt.

## When to Use

- The user asks for a new task prompt or a revision to an existing one.
- They describe a situation and ask how to instruct another agent.

## When to Skip

- They want the task performed: use the relevant domain tools or agent.
- They want a skill or agent definition: use `skill-crafting` or `agent-crafting`.
- They need a factual answer rather than a prompt.

Do not create prompts intended to evade safeguards, extract secrets, deceive
users, or cause harm. Redirect to a legitimate goal or decline.

## Procedure

### 1. Identify the outcome

Extract the goal, necessary context, receiving agent/tool environment, and
expected artifact. Distinguish analysis or a plan from implementation.
Do not assume tools, credentials, data access, or permission the user did not
provide.

For a revision, identify the observed failure before adding instructions.
Check for a buried objective, missing constraint, conflicting steps,
unnecessary context, or an early stopping point.

Ask only when a critical unknown prevents a safe, useful prompt. Otherwise
make a reasonable assumption and mention it only if it changes the result.

### 2. Define the boundary and completion

State the objective first, followed by context the receiving agent cannot
infer and the constraints that affect the result.

For implementation, define the finished artifact and affected validation.
Permit the receiving agent to fix failures caused by its changes and continue
until the result meets those criteria. Keep explicit review stops and
approval boundaries for destructive, external, or out-of-scope actions.
Do not turn a plan-only request into execution.

Respect any stated time or cost budget. Stop and report missing access,
an unavailable required check, or repeated attempts that make no progress;
do not prescribe an unlimited retry loop.

Match verification to the task. A small edit should not require reading a
whole repository or running every test. Specify the dependency order only
where correctness or authorization requires it.

### 3. Draft only the needed structure

Use plain language by default. Add a role when it changes judgement, headers
or tags when they separate substantial inputs, and examples when they clarify
an output contract. These are options, not a required template.

Keep exact tool or format requirements supplied by the user. Leave safe
implementation choices open. Do not add generic reasoning rituals or a model-
specific instruction without a task-relevant reason.

Read [techniques and examples](references/techniques.md) only for a complex
input, a specific output format, a worked example, or a requested explanation.
The reference is not needed for a straightforward prompt.

### 4. Deliver

Return the finished prompt in one fenced code block. Add a brief note only
for a material assumption, unresolved constraint, or requested explanation.
Do not append a routine assumptions list or iteration offer.

## Completion

The prompt preserves the user's intent, states an observable result and
relevant limits, and contains no unnecessary instructions or invented access.
For implementation tasks, it asks for completion rather than an unrequested
pause after the first draft.
