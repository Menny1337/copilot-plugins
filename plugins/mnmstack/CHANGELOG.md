# Changelog

## [1.2.0] - 2026-11-05

_minor release._

- Import anatomy, bro, humanizer, show-me, and teach with their tracked
  supporting files and available licenses and attribution.
- Preserve manual-only invocation metadata for bro and teach.
- Adapt only Humanizer metadata and its package checks to scalar-only
  frontmatter, without changing its prompt body.
- Verify historical upstream matches for bro, show-me, and all five teach
  files; retain their MIT licenses and copyright holders with pinned evidence.

## [1.1.2] - 2026-11-04

_patch release._

- fix(publish-html): support native delegated publisher sessions

## [1.1.1] - 2026-11-03

_patch release._

- fix(publish-html): refine manager sorting and sticky details

## [1.1.0] - 2026-11-03

_minor release._

- feat(publish-html): add hosted page manager and version-linked previews

## [1.0.3] - 2026-10-28

_patch release._

- fix(assistant-store): run CLI through generated symlinks

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
