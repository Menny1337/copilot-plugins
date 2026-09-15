# Open pull requests

Read for an on-demand PR query or when generating/refreshing a briefing. PR sources
come from config independently of the personal task backend; do not load task
CRUD references or generate a briefing merely to list PRs.

## 9. Active Pull Requests

The user's open pull requests are a **standing briefing section** and an on-demand query
("show my active PRs", "my open PRs", "PRs waiting on me", "add my active PRs to the
briefing"). Compute this section by default rather than waiting to be asked.

PRs are **repo objects, not work items**, so they come from `az repos pr list` / `gh` —
**not** from `ado-query`, which only builds `az boards` WIQL ([§8](ado-queries.md)). Do not try to force PRs
through a board lane.

### Sources

List PRs **authored by the user** across every org they work in. Read the identity and
orgs from the [selected assistant config](../../assistant-capture/references/configuration.md):

- **Creator:** `<config.ado.assignedTo>` (the user's email).
- **ADO orgs/projects:** `<config.ado.org>`/`<config.ado.project>` (personal) and
  `<config.teamBoard.org>`/`<config.teamBoard.project>` (team), plus any extra
  `{ "org": …, "project": … }` pairs in the optional `config.prSources` array. The user
  often has PRs in work orgs beyond the two boards — if a recently-mentioned PR lives in an
  org that isn't configured, surface it anyway and offer to save that org/project to
  `prSources` so future briefings include it automatically.
- **GitHub (only if the user has GitHub repos):** `gh search prs --author "@me" --state open`.

### Query

```bash
ME="<config.ado.assignedTo>"
# Per configured ADO org/project (repeat for each source):
az repos pr list --org "<org>" --project "<project>" \
  --creator "$ME" --status active -o json 2>/dev/null \
  | jq -r '.[] | "\(.pullRequestId)\t\(.repository.name)\t\(.isDraft)\t\(.title)"'

# GitHub, across every repo the user authors in:
gh search prs --author "@me" --state open \
  --json number,title,repository,url,isDraft 2>/dev/null
```

`--status active` already excludes completed/abandoned PRs; keep drafts but tag them
`_(draft)_`. ADO PR link: `<org>/<project>/_git/<repo>/pullrequest/<pullRequestId>`.

### Render

Group by org/repo; one line per PR. **Hide the whole section when the user has zero open
PRs** (do not print an empty heading).

```
## 🔀 Active Pull Requests

**<org> / <project>**
- **[!12345](<org>/<project>/_git/<repo>/pullrequest/12345)** Short PR title · 2 reviewers pending
- **[!12346](<org>/<project>/_git/<repo>/pullrequest/12346)** _(draft)_ Another change

_3 open · 1 waiting on reviewers_
```

When reviewer/vote data is available, annotate who still needs to approve and flag PRs with
active (unresolved) comment threads — that is the judgment the raw list does not encode. If
`az`/`gh` is unavailable or unauthenticated, write
`_PR sources unavailable — run \`az login\` / \`gh auth login\`_` rather than omitting the
heading silently.

### Briefing integration

- **[Daily (§4, step 7b)](daily-briefing.md):** render after the ADO work-item sections, before Recent Notes;
  add the open-PR count to the chat summary (e.g. `🔀 PRs: 3 open (1 needs review)`).
- **[Weekly (§5, step 6c)](weekly-briefing.md):** same list, plus surface PRs open all week or blocking a sprint
  commitment under **Known blockers**.
- **On demand:** the same query answers "what are my open PRs?" without generating a full
  briefing.
