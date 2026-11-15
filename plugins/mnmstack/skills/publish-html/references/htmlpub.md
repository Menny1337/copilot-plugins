# The htmlpub command

Use `htmlpub` to set up a publisher and manage trusted HTML reports. It uses
the existing own-API authentication and recovery engines. Installation adds
the command only. Creating resources, enabling logging and activating
publishing each need separate approval.

## Install the local command

Requirements: Node.js 24 and npm. Setup and bearer publishing also require an
already installed Azure CLI. Resolve this
skill's actual directory from the loaded plugin. It contains `package.json`
with an npm `bin` entry, no dependencies and no lifecycle scripts.

Run this only after installation is approved:

```text
npm install --global --ignore-scripts "<absolute-publish-html-skill-directory>"
htmlpub --help
```

This installs the local private package without downloading an `htmlpub`
registry package. The local package has its own version, separate from the
marketplace release version, and includes its MIT license. npm creates the POSIX executable link
and Windows `htmlpub.cmd`/`htmlpub.ps1` launchers. The source directory must
remain available. Reinstall from the selected skill directory if a plugin
update changes its location.
The package includes the command, its runtime/setup dependencies, templates
and guides. It also includes the unchanged MIT-licensed browser runtime from
this plugin's browser skill, so a packed installation does not depend on a
sibling skill directory. Tests, test helpers and recording fixtures stay in
the source checkout.

The npm global executable directory must be on PATH. On POSIX it is normally
`<npm-prefix>/bin`; on Windows it is the npm prefix itself. Inspect it with
`npm prefix --global` if the command is not found. In PowerShell, use
`htmlpub.cmd` if policy blocks the npm PowerShell shim; do not weaken that
policy. A no-install source entry point is also available:

```text
node "<skill-directory>/scripts/htmlpub.mjs" --help
```

Setup is implemented for Windows, macOS and Linux. Native Windows execution
has not been validated. The default bearer publishing transport is POSIX-only:
`list`, `publish`, `replace`, `delete`, `restore` and publishing recovery refuse
Windows before credential acquisition. This does not change the historical
PowerShell helper's separate support.

## Optional browser publishing

Use `--browser` explicitly, or set `publisher.transport` to `browser` in the
private existing-host profile. Bearer remains the default for other targets.
This mode requires installed Microsoft Edge and a compatible `playwright-cli`
(at least 0.1.19). The browser activity adapter also checks its supported
Playwright core build. The command reports missing or incompatible capability;
it never installs tools or changes browser/global CLI settings.

The command opens a fresh owned browser session, uses the canonical manager
page, and sends normal same-origin page-context fetches to the same manager
API. Cookies stay in the browser. It does not read OAuth tokens, export
cookies, attach to a normal browser profile or fall back to bearer HTTP.
After SSO, the CLI checks the current canonical document, not an earlier
navigation response. A verified same-origin 403 with bounded `manager-origin`
JSON allows one canonical revisit within the readiness deadline, including
the MFA resume. Other denials and all API failures are not retried.
The CLI waits for the initial UI inventory and its background requests to
finish before it sends its own API request. Static page nodes are not readiness.
Finish any required sign-in or MFA in that window, then confirm in the terminal.
Redirected input fails explicitly when sign-in needs action. A foreground
browser can prevent safe launch; place a stable non-browser application in
front and try the command again. The CLI does not bypass that safety check.
The owned window is closed after the command; its private browser profile is
retained by the browser runtime.

```text
htmlpub list --browser --config "<absolute-private-path>/resources.json"
htmlpub publish "<trusted-report.html>" --browser --config "<absolute-private-path>/resources.json"
```

`--browser-runtime <absolute-browser-window.mjs>` selects an explicitly trusted
local runtime file if needed. The normal packed installation uses its bundled runtime.
Browser transport uses the existing macOS/Windows helper. Linux is unsupported;
native Windows browser publishing remains unverified.

## Guided setup

```text
htmlpub setup
htmlpub --setup
htmlpub setup --config "<absolute-private-path>/resources.json"
```

Both setup spellings open the same wizard. Use Up/Down and Enter to choose an
item. In menus for existing reader groups, managers and approved client apps,
press Space to toggle each item, then Enter to keep the selection. The menu
shows `>` for the current item and `[x]` for selected items. You can also enter
known IDs when a directory page does not include them.

Esc or Ctrl+C saves previously confirmed answers and exits without approving
the pending change. The terminal restores its cursor and input mode. Text
prompts also accept `:save`. An unfinished text answer or untoggled menu item
is not saved. Resume with the same command and config path. Answers are in
the private `<config>.guided.json` draft. You do not need to edit JSON or
copy approval hashes.

To go back after reviewing a new setup, choose Change settings. Its Back to
review item returns without changing answers. Esc always saves and exits,
including on this screen. Exact typed confirmations such as `APPLY diagnostics`
and `DELETE report.html` still apply.

Cyan marks the current prompt or choice, green marks completed steps, amber
marks warnings and blocked steps, and red marks errors. Secondary hints use
dim text. Every state also has a text label. `NO_COLOR` disables color while
keeping the cursor controls needed for interactive menus. `TERM=dumb` uses
plain numbered choices (commas for multiple choices) with no ANSI output.
Narrow terminals show the current choice on new lines instead of redrawing a
wide menu. Resize starts a new frame to avoid erasing reflowed text.

The wizard needs a terminal for both stdin and stdout. Redirected streams,
`--non-interactive` and `--json` never open prompts. Machine JSON and captured
errors contain no terminal formatting. Incomplete automation fails rather
than choosing or approving an action for you.

If you have a saved inventory or draft, choose whether to continue, view its
settings or exit. The wizard keeps the resource and logging choices in an
existing inventory. Reconcile uncertain changes before starting another
operation. If the publisher check failed, ask the host owner to fix it, then
choose and approve one new check. The default saves and exits without another
sign-in.

For new requests:

1. Select the subscription and tenant from enabled public-Azure accounts.
   The command verifies that context without switching shared CLI defaults.
2. Accept or edit the resource prefix. A usable Azure CLI user UPN can suggest
   `<user_alias>-html-publishing`. If it would exceed 40 characters, the hint
   keeps part of the alias and adds a 12-character hash of the full lowercase
   UPN before `-html-publishing`. This preserves differences in shortened
   names without guaranteeing that an Azure name is available. Setup still
   refuses name collisions. Explicit names you enter are never shortened.
   A missing alias, non-ASCII/unsupported alias, service principal or display
   name cannot provide one. This is a naming hint, not a manager identity.
3. Select create/reuse, resource group, region and paid Linux hosting tier.
   Reuse choices are scoped to that subscription/group or tenant. Directory
   menus show the first 50 results and offer exact known IDs for other entries.
4. Space-select existing reader groups, manager users and approved delegated
   client applications. You can also create reader groups. New groups are
   empty; setup does not add members.
5. Review the logging workspace, retention and daily quota. Logging is included
   by default in newly guided plans, without an opt-in question. The default
   retention is 30 days and the default quota is 1 GB/day, not a hard spend cap.
6. Review all desired resources, private config location and cost assumptions.
   Choose change settings, save/exit or continue to exact operation approvals.

Hosting estimates use a bounded public Azure Retail Prices read for the
selected region/tier. An unambiguous Linux USD hourly quote is multiplied by
730 hours for one monthly instance. Tax, log ingestion/export/retention,
storage and egress are excluded. Missing or ambiguous quotes show as unavailable. Reused/shared hosting is not necessarily a new
incremental cost. Verify prices and workload volume before accepting charges.

Logging can retain sensitive authentication telemetry about other users.
Workspace access and networking are inherited; a personal-sounding name does
not make the logs exclusive. Public ingestion/query endpoints may be enabled.
Export, ingestion and retention can cost money. Quotas are not hard spending
limits. Appsettings, routing and startup changes can restart the app.

Each stage that changes resources displays its exact generated fields and effects, then
requires a phrase such as `APPLY diagnostics`. The underlying engine binds the
approval to its preview, rechecks drift and writes its recovery journal.
This confirmation still requires the caller's human/tool authority.
`[done]`, `[running]`, `[pending]` and `[blocked]` distinguish progress from
real publishing acceptance.

Record owner evidence only for checks already performed. Supply the actual UTC
time and a private evidence reference. The command must read inventory through
the real delegated bearer publisher on the host's verified matching runtime.
Successful provisioning, token issuance or source tests cannot mark that check
as passed. The publisher does not call the older native sign-in endpoint.

The default inventory is `~/.copilot/html-publisher/resources.json`. If this
location is Git-managed, the wizard asks for another private path. Pass that
same explicit `--config` on later commands. Private permissions, Windows
DACLs, locks and legacy recovery rules remain mandatory.

## Routine commands

An already working host can use a private `htmlpub-existing-host-v1` config
instead of a provisioning inventory. The host owner records the exact observed
site and app registration, any other known resources, actual runtime file
hashes and startup, and references to a successful authenticated inventory read
and verified publication receipt. Unknown resource locations remain `null`;
shared resources are `reused` or `external`, with uncertain ownership recorded
as `unknown`. An unknown application object ID or display name is also `null`;
the separately observed application client ID remains required. Record a check's
actual actor object ID only when independently observed; never substitute the
Azure CLI account for the browser actor. The profile stores no credentials.
It does not create resources, deploy a wrapper, enable logging or change access.

The inventory and publication checks bind the target, observations and runtime
through `existingHostHash` from `scripts/onboarding/state.mjs`. Publication also
records its transaction ID, filename and readback SHA-256. Mutations require
checks and runtime verification from the past 24 hours and matching deployed
`auth.mjs` and `server.mjs` source hashes. Explicit browser mode also accepts the
exact known auth source before the two bearer-only identity-binding lines were
added, because its browser authorization path is unchanged. That source is
never accepted for bearer mutations. Browser acceptance must come from real
browser CLI inventory and publication, not a successful bearer token request.
A token-issued claim, changed target or unknown runtime cannot approve publishing.
Use `status`, `resources` or `list` to
inspect this profile; keep full setup for explicit provisioning requests.

```text
htmlpub status
htmlpub resources
htmlpub list
htmlpub publish "/private/new-report.html"
htmlpub replace "/private/report.html"
htmlpub delete report.html
htmlpub restore
htmlpub recover
```

Use `--config` on each command for a non-default inventory. `status` and
`resources` read local metadata only. `list` uses the selected transport to read
manager inventory; inventory retention can write host state.

Before a guided write, the command fetches the inventory and displays the exact
origin, filename, current revision/hash and local content hash. Restore
requires selection of an actual retained backup with its name, date, ID and
hash. If no retained backup exists, restore stops. Restore
can recreate a missing destination or replace its displayed current version.
Type `REPLACE report.html`, `DELETE report.html` or `RESTORE report.html` to
approve the displayed version; no revision/hash copying is needed.

The write uses the version you reviewed and the backup you chose.
If the server reports a conflict, the command stops without refreshing or retrying.
Local HTML changes after review are refused before obtaining mutation credentials.
Publish never becomes replace. Same-origin report scripts retain application
privileges, so only reviewed first-party HTML is suitable.

Review and mutation are separate authenticated client invocations. They use
the same approved manager API without creating a platform session or sending
cookies. A denied request stops without retry, fallback, permission repair or activation.
Only the existing client's fully verified mutation response produces a
published URL.

### Recovery

`recover` uses the existing setup recovery engine when setup is uncertain.
It previews and confirms recovery before applying it, including any temporary
SCM access. It never blindly resubmits the failed deployment or consent.

Publishing records a private `<config>.publish.json` journal before mutation.
An interrupted or uncertain submission blocks further mutations using that
journal. Publishing recovery reads inventory once, displays the observation
and requires owner review of private host transaction evidence before
`ACCEPT OBSERVED report.html`. This records an owner-reconciled observation,
not proof that the original request succeeded. It never replays the mutation
or removes a host-side lock. Keep one coordinator per host across configs
and machines; local journals do not fence unrelated writers.

The old PowerShell uploader and its `-Recover` remain separate. `htmlpub`
does not silently invoke them or adopt legacy config after a publisher failure.

## Automation

Redirected input and `--non-interactive` never open prompts. `--json` also
disables prompts and returns structured output. Incomplete arguments fail
before credential acquisition. Complete arguments use the same protocol:

```text
htmlpub publish "/private/new.html" --confirm new.html --non-interactive --json
htmlpub replace "/private/report.html" --confirm report.html --revision "<reviewed-revision>" --sha256 "<reviewed-current-sha>" --non-interactive --json
htmlpub delete report.html --confirm report.html --revision "<reviewed-revision>" --sha256 "<reviewed-current-sha>" --non-interactive --json
htmlpub restore --name report.html --confirm report.html --revision "<reviewed-current-or-deleted-revision>" --sha256 "<reviewed-current-sha-or-missing>" --backup-id "<selected-guid>" --backup-sha256 "<selected-sha>" --non-interactive --json
```

Optional `--file-sha256` binds upload/replace to an externally reviewed local
file. Existing thumbnail flags are passed to the existing publisher; no
thumbnail capture is implicit.

Complete explicit `--origin`, `--tenant` and `--api-client` remain supported,
but cannot be combined with `--config`. Use an explicit private `--journal`
when the default journal location is unsuitable. Publishing recovery with
that journal reads its exact saved target; a conflicting selected inventory
is refused before credentials.

Structured setup remains available through the same command:

```text
htmlpub setup plan --request "<private-request.json>" --config "<resources.json>" --stage resources --json
htmlpub setup apply --config "<resources.json>" --stage resources --approve "<reviewed-preview-sha256>" --json
htmlpub setup evidence --config "<resources.json>" --evidence "<private-evidence.json>" --json
htmlpub setup recover --config "<resources.json>" --json
htmlpub recover --config "<resources.json>" --approve "<reviewed-recovery-sha256>" --json
```

These are advanced engine operations, not the human wizard. Their request
defaults are explicit: `diagnostics.mode: off` stays off. Hashes bind scope,
not authenticated approval. Uncertain publishing recovery fails closed in
automation because it requires owner transaction review.
Guided blocked results exit with code 1; pending acceptance exits with code 2.
User-selected save/exit is not reported as a successful deployment.

See [onboarding.md](onboarding.md) for the engine, evidence requirements,
resource inventory and platform boundaries. The source/offline validation
does not perform installation, cloud operations or live acceptance.
