# Third-party skill notices

The five skills below were imported from the tracked personal skill source at
revision `b8d5fd983c5e11b4f4a5b9e406ada572bb3d7c14`. This revision identifies
the migration snapshot, not an upstream release or an authorship claim.
All tracked supporting files, including hidden files, are retained. The source
snapshot did not include license files for `bro`, `show-me`, or `teach`.
Their license files were added from the verified upstream revisions below.

| Skill | Verified attribution | License retained in this package |
| --- | --- | --- |
| [anatomy](skills/anatomy/README.md) | Ryan, [wheresryan22/anatomy](https://github.com/wheresryan22/anatomy) | [MIT, copyright 2026 Ryan](skills/anatomy/LICENSE) |
| [humanizer](skills/humanizer/README.md) | [blader/humanizer](https://github.com/blader/humanizer), copyright Siqi Chen | [MIT, copyright 2025 Siqi Chen](skills/humanizer/LICENSE) |
| [bro](skills/bro/SKILL.md) | Lauren Tan, [cursor/plugins pstack](https://github.com/cursor/plugins/tree/main/pstack) | [MIT, copyright 2026 Lauren Tan](skills/bro/LICENSE) |
| [show-me](skills/show-me/SKILL.md) | [HumanLayer skills](https://github.com/humanlayer/skills) | [MIT, copyright 2026 HumanLayer](skills/show-me/LICENSE) |
| [teach](skills/teach/SKILL.md) | [Matt Pocock skills](https://github.com/mattpocock/skills) | [MIT, copyright 2026 Matt Pocock](skills/teach/LICENSE) |

These skills retain their upstream licenses and copyright holders. Do not
attribute them to the marketplace maintainer. The MIT terms require the
copyright and permission notices to remain with copies or substantial portions.

## Verified upstream evidence

Checked on 2026-11-05 using the primary repositories' source files and licenses.
The historical revisions below predate the local imports. Comparisons normalize
CRLF/LF line endings and a final newline only; no prompt wording or metadata
was changed. This establishes matching upstream material, not the original
download method.

| Skill | Matching upstream material | License at the same revision |
| --- | --- | --- |
| bro | [Complete skill](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/bro/SKILL.md), revision `99559f2f52047978602ef365589275831e76af07` | [pstack MIT license](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/LICENSE) |
| show-me | [Complete skill](https://github.com/humanlayer/skills/blob/6ab9013a10c28f5046f7f999549cd5328a0b30d7/plugins/show-me/skills/show-me/SKILL.md), revision `6ab9013a10c28f5046f7f999549cd5328a0b30d7` | [HumanLayer MIT license](https://github.com/humanlayer/skills/blob/6ab9013a10c28f5046f7f999549cd5328a0b30d7/LICENSE) |
| teach | [Complete skill](https://github.com/mattpocock/skills/blob/391a2701dd948f94f56a39f7533f8eea9a859c87/skills/productivity/teach/SKILL.md) and its four adjacent `*-FORMAT.md` files, revision `391a2701dd948f94f56a39f7533f8eea9a859c87` | [Matt Pocock MIT license](https://github.com/mattpocock/skills/blob/391a2701dd948f94f56a39f7533f8eea9a859c87/LICENSE) |

`bro` and `show-me` entered the local source in commit
`9189b1cb854089fd08cd3543cad77a9553414198`. The five `teach` files entered in
commit `f83ea1501c3e683b00f8b80491433f28b0c8cae3`. Those import commits did
not record upstream links. The direct historical matches resolve that gap.
Newer upstream versions are not substituted for the imported snapshots.

## Humanizer packaging adaptation

Humanizer's prompt body is unchanged. The marketplace requires single-line,
top-level scalar frontmatter. Its description is folded to one line, and its
informational `metadata.version` is stored as the scalar `metadata-version`.
The package checker, agent guidance, README, and changelog describe this local
adaptation. Upstream plugin manifests, upstream version `3.1.0`, attribution,
license, and all other supporting files are unchanged.

Original source frontmatter:

```yaml
---
name: humanizer
description: |
  Rewrite AI-sounding text so it reads like the writer without changing what it says.
  Use when editing or reviewing prose for AI tells: not-X-but-Y contrasts, one-line
  closers, staged openers, forced triads, dashes everywhere, inflated claims, sales
  language, stock AI words, bold labels, or filler. Based on Wikipedia's "Signs of AI writing."
license: MIT
metadata:
  version: "3.1.0"
---
```
