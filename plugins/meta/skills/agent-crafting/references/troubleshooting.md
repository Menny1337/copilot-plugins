<!-- validate:allow-user-paths -->
# Agent troubleshooting

Read this when an agent fails to load, does not appear, or does not trigger.

## "Attribute X is not supported" error

Check the target host, version, and repository validator before removing a field.
The general GitHub custom-agent configuration table lists: `name`, `description`, `tools`, `model`, `target`,
`disable-model-invocation`, `user-invocable`, `mcp-servers`, and `metadata`. `infer` is
retired — replace it with `disable-model-invocation` and `user-invocable`. `argument-hint`
and `handoffs` are VS Code-only and are ignored elsewhere rather than erroring.

CLI additions include `skills`, `reasoning-effort`, `deferred-tool-loading`,
`include-custom-instructions`, and
`model-policy`. Since CLI 1.0.83, `model` may also be a string array; use
`model-policy: required` to keep model changes within that configured list.

The specialized hooks reference also documents CLI agent-scoped `hooks`, absent
from the general table. See [Hooks and agents](advanced-topics.md#hooks-and-agents)
for host verification and the separate marketplace schema/approval boundary.
A runtime-supported nested map can still fail this repository's scalar-only
frontmatter validator; do not remove that safeguard to make it pass.

## "Unexpected indentation" error

Caused by multi-line `description` using a YAML folded scalar (`>`). Convert to a
single-line quoted string.

## Agent not appearing in Copilot Chat

- Verify the file is in the correct directory with the `.agent.md` extension
- Check that `user-invocable` is not set to `false`
- For repo-level: must be in `.github/agents/`
- For user-level: must be in `~/.copilot/agents/`
- For plugin: must be in the plugin's `agents/` directory and the plugin must be installed
- Restart VS Code or reload the window

## Agent not triggering on expected prompts

- Check `description` — it is used for matching user intent to agents
- Make the description specific about capabilities and trigger keywords
- Ensure the agent isn't shadowed by a higher-precedence agent with the same name
