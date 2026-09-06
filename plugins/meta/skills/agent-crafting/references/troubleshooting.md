<!-- validate:allow-user-paths -->
# Agent troubleshooting

Read this when an agent fails to load, does not appear, or does not trigger.

## "Attribute X is not supported" error

Remove the unsupported attribute. The documented frontmatter properties (GitHub.com +
Copilot CLI) are: `name`, `description`, `tools`, `model`, `target`,
`disable-model-invocation`, `user-invocable`, `mcp-servers`, and `metadata`. `infer` is
retired — replace it with `disable-model-invocation` and `user-invocable`. `argument-hint`
and `handoffs` are VS Code-only and are ignored elsewhere rather than erroring.

CLI additions are `skills`, `reasoning-effort`, `deferred-tool-loading`, and
`model-policy`. Since CLI 1.0.83, `model` may also be a string array; use
`model-policy: required` to keep model changes within that configured list.

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
