# Changelog

All notable changes to the `core-skills` plugin are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to [Semantic Versioning](https://semver.org/).

## [4.0.0] - 2026-10-27

_major release._

- feat(core-skills)!: simplify browser sessions with owned profiles
- **Migration:** default browser starts now use a fresh, agent-owned profile.
  Run CLI and site-driver commands from the returned `cwd`, with its explicit session.
  To use an existing normal profile, pass `--profile <name>` to select Bridge.
- Managed sessions support active pages only. Native activity requires
  `start --profile <name> --activity native`.
- Profiles remain on disk after verified shutdown; deleting them requires user approval.
- Shorten the root browser workflow, retain exact ownership checks, and fix Outlook's
  renamed compose control and full-page discard verification.
- Add scoped authentication diagnostics, regression coverage in CI, and validation notes
  in `docs/browser-validation.md`.

## [3.4.0] - 2026-10-26

_minor release._

- docs(core-skills): explain browser activity compatibility and recovery
- feat(core-skills): add session-local browser activity modes

## [3.3.1] - 2026-10-06

_patch release._

- fix(core-skills): harden create-image request and output handling

## [3.3.0] - 2026-09-15

_Initial public release._

- Published a de-personalized, generic version of this plugin to the public marketplace.

## [2.3.0] - 2026-07-26

_Initial public release._

- Published a de-personalized, generic version of this plugin to the public marketplace.

## [2.2.0] - 2026-07-25

_Initial public release._

- Published a de-personalized, generic version of this plugin to the public marketplace.

## [2.0.7] - 2026-07-24

_Initial public release._

- Published a de-personalized, generic version of this plugin to the public marketplace.

## [2.0.5] - 2026-07-21

_Initial public release._

- Published a de-personalized, generic version of this plugin to the public marketplace.

## [2.0.4] - 2026-07-21

_Initial public release._

- Published a de-personalized, generic version of this plugin to the public marketplace.
