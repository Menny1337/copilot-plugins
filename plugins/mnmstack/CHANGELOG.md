# Changelog

## [1.0.2] - 2026-10-27

_patch release._

- fix(loops): wait for SIGTERM handler readiness in shutdown test

## [1.0.1] - 2026-10-27

_patch release._

- feat(mnmstack)!: consolidate the default stack into skills

## [1.0.0] - 2026-10-27

- Replace core-skills, core-agents, and meta with one skill-first plugin.
- Preserve existing skill names, shared helpers, and startup hooks.
- Fold assistant, Azure, research, and customization workflows into skills
  and remove the four custom agent definitions.
- Document the clean-break installation switch and unchanged private-data paths.
- Retire the unreleased assistant-workflows wrapper in favor of direct domain
  skills; add issue-updates for GitHub issue and ADO work-item maintenance.
