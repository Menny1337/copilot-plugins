# AGENTS.md — working on this repo

This is a **generated**, public Copilot CLI / Agency plugin marketplace. It contains content
plus four zero-dependency Node scripts; there is no build or runtime app.

## CI-enforced rules

1. **Generated docs are outputs.** Do not hand-edit `CATALOG.md`, the root README block
   between `<!-- mnm:catalog:start -->` / `<!-- mnm:catalog:end -->`, or plugin README
   generated blocks between `<!-- mnm:plugin-readme:start -->` / `<!-- mnm:plugin-readme:end -->`.
2. **Regenerate outputs** with `node scripts/catalog.mjs` and `node scripts/plugin-readme.mjs`
   after any skill/agent/hook/manifest change.
3. **Frontmatter is required and scalar-only** for every `SKILL.md` and `*.agent.md`.
4. **Names are unique per type** across plugins (skills vs skills, agents vs agents).
5. **Hooks point to files, not directories** (e.g. `"hooks": "hooks/hooks.json"`).

## Local workflow

```bash
node scripts/validate.mjs
node scripts/catalog.mjs
node scripts/plugin-readme.mjs
node scripts/catalog.mjs --check
node scripts/plugin-readme.mjs --check
node scripts/version.mjs plan
```
