# Hosted page manager

This is reusable host-application source, not a routine HTML upload. Installing
the skill does not deploy it. Deployment, app registration, consent, storage
validation and mutation activation require separate host-owner approval.
Source and offline tests do not prove that these live prerequisites work.

## Contents

- Runtime and configuration
- Authentication and trust
- Browser library
- Automated publisher
- Storage protocol and recovery
- Activation gates
- Offline checks and limits

## Runtime and configuration

The zero-dependency source is in `scripts/hosted-manager/`. Use POSIX Node.js 24.
The host entrypoint is `node server.mjs`. Copy its runtime modules
(`server.mjs`, `config.mjs`, `common.mjs`, `auth.mjs`, `store.mjs`, `client-protocol.mjs`),
`png.mjs`, `manager.html` and `manager-ui.mjs` together during an approved application
deployment. Keep `publish.mjs` with `common.mjs`, `png.mjs` and `client-protocol.mjs` on publisher machines and `recover.mjs` for
offline operator recovery. Do not copy test fixtures into the application.
No package installation is required.

Keep all environment identifiers and runtime state outside the public source
checkout. Create the content directory in advance. The private state directory
is requested with mode 0700, with its existing parent required to be a real
directory. This is not a permission guarantee: CIFS can report 0777 despite
the requested mode. Content and private state must be disjoint trees on the same
filesystem. Every parent must be a real directory, not a symlink.
The private state location must also be outside the deployed application
bundle and every directory exposed by any other web/static server.
Confidentiality depends on strict server path confinement, manager authorization
and the approved App Service application/storage isolation boundary, not chmod.
Host administrators and other principals with volume access can read or mutate
this evidence. Do not claim OS-private state where the filesystem cannot
enforce it. Review that isolation boundary before activation.

| Environment key | Contract |
| --- | --- |
| `TENANT_ID` | Approved single-tenant GUID |
| `ALLOWED_GROUP_IDS` | 1-20 unique reader group GUIDs, comma-separated |
| `HTML_MANAGER_OBJECT_IDS` | Explicit manager user object GUIDs, comma-separated |
| `HTML_MANAGER_ORIGIN` | Exact approved HTTPS origin, no path, port or credentials |
| `HTML_CONTENT_DIR` | Absolute normalized directory containing existing flat reports/assets |
| `HTML_MANAGER_STATE_DIR` | Absolute private state directory outside served content and public source |
| `HTML_MANAGER_MUTATIONS_ENABLED` | `false` by default; `true` only after all activation gates pass |
| `HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN` | `true` only after every legacy/manual publisher is frozen and migrated |
| `HTML_MANAGER_BACKUP_RETENTION_DAYS` | Approved value `90`, the default |
| `HTML_MANAGER_AUDIT_RETENTION_DAYS` | Approved value `365`, the default |
| `HTML_MANAGER_OWN_API_ENABLED` | `false` by default; required for mutation activation |
| `HTML_MANAGER_API_CLIENT_ID` | Own-API application GUID; expected v2 token audience |
| `HTML_MANAGER_ALLOWED_CLIENT_IDS` | Narrow approved delegated client app GUID allowlist |
| `HTML_MANAGER_MI_CLIENT_ID` | Host user-assigned managed identity client GUID |
| `IDENTITY_ENDPOINT`, `IDENTITY_HEADER` | Platform-provided App Service MI endpoint/header; never log or persist the header |
| `PORT` | Host port, default 8080 |

`HTML_CONTENT_DIR` defaults to `content/` beside the server for compatibility,
but an explicit runtime path is recommended. There are no real identifiers in
the source or templates. Invalid flags, retention values, identifiers, origins
and path relationships stop startup rather than silently selecting a fallback.

## Authentication and trust

The application must remain behind mandatory EasyAuth and the existing network
reader policy, with no authentication exclusions or direct origin bypass.
The server trusts EasyAuth platform headers only under that deployment boundary.
It strictly parses the principal, binds tenant/object claims and Graph `/me`
to the same user, then checks only the configured reader group IDs.
Existing `/`, flat report and asset GET/HEAD routes keep normal JavaScript.

The chosen same-app design requires the own-API app client ID to be the existing
EasyAuth app client ID. Its Entra registration must set
`api.requestedAccessTokenVersion` to `2`. Retain the existing exact client ID
as EasyAuth's sole `allowedAudiences` entry. Do not add a resource URI or accept
another audience to bypass a rejection. Prove real bearer admission through
EasyAuth on the deployed host before activation; token issuance alone is not
that proof.

`/_manager`, its script, inventory and mutations additionally require an
explicit configured manager user. Inventory is not available to ordinary
readers. The manager lists configured tenant/group requirements, not individual
people's entitlement. It does not attest or change Azure ingress settings.

Own-API automation verifies an RS256 signature against tenant signing keys,
v2 issuer, tenant, app audience, allowed client (`azp`), delegated
`publish_as_user` scope, user object ID, `nbf` and `exp`. It does not accept
an ARM or Graph token as an own-API assertion. It then obtains a managed-identity
federated app assertion for `api://AzureADTokenExchange` and performs confidential
OBO with both that assertion and the actual user assertion. The delegated Graph
token remains server-side and must pass the same `/me` binding and reader-group
checks. No Graph application permission or ARM role is needed for filesystem
management. Consent, claims challenges and policy errors fail closed, with no
browser-only or Kudu fallback.

The UI uses EasyAuth cookies, same-origin requests, exact host/origin checks and
a custom JSON request header. No CORS is enabled. These guards do **not** isolate
the manager from trusted same-origin report JavaScript. Reviewed first-party
report code has the user's application privileges, including manager privileges.
Never publish arbitrary third-party HTML under this origin.
Remote metadata uses DOM text nodes. The manager never embeds report HTML.

Manager POST requests set the fetch option `referrerPolicy: 'same-origin'`
so the browser supplies its same-origin page Referer to existing EasyAuth CSRF
checks. They do not set an explicit referrer or read cookies/tokens. Inventory
GET requests keep the default policy. The global server/report
`Referrer-Policy: no-referrer` header and all origin, credential, custom-header,
CSP and authentication requirements remain unchanged; CSRF checks are not disabled.

## Browser library

The browser manager is a compact live-page table and a selected-page detail
rail. Search and sort do not change the selected page. Open uses a separate
tab; the manager never fetches or executes report HTML for selection.
Upload and replace remain available through the skill and own-API CLI/API,
not through browser publishing forms.

Select anywhere on a page row to inspect its size, dates and provenance.
Open and Delete keep their separate actions. The filename button also supports
keyboard selection. Expand Technical
details for the hash, revision, actor object ID, inventory timestamp and
unmanaged-entry count. Revisions can be transaction IDs, `untracked:<sha256>`
or missing. These are not invented page IDs. Configured tenant and reader-group
IDs describe host-wide requirements, not resolved people, group names,
per-page access lists or effective entitlement. Inventory does not attest
network admission.

Delete and Restore both require the exact filename. Restore identifies the
selected backup ID, hash, size and saved time, and states whether it creates a
missing destination or replaces an existing version. Deleted selection stays
available for backup history. The history selector also finds missing pages
after a reload. Backup numbering is a local display label; IDs and hashes are
the durable version identifiers. No backup actor or original upload date is
inferred from a restore. A known replacement timestamp is labeled as a
replacement, not the original upload.

Read-only mode disables Delete and Restore. A verified mutation reloads the
inventory and preserves the selected filename. Definite refusals and uncertain
outcomes retain the displayed context as last-known, disable further mutations
and require an explicit refresh. An uncertain result is not success; inspect
private transaction evidence before another mutation. Never retry blindly.

Static PNGs come from the publisher, never a renderer on the host. Rows,
selected-page/backup details and confirmation show only the image bound to
that HTML hash. Restore copies the selected backup's image into the new
version. Versions without an image, including historical reports/backups,
explicitly show Preview unavailable. Image-request failure is also labeled,
not replaced with an example screenshot. Selecting a page never executes or
fetches its HTML. The image route requires the same manager and reader gates;
ordinary report readers cannot enumerate or read private thumbnails.

## Automated publisher

Use the source-relative `scripts/hosted-manager/publish.mjs` after approved
cutover. It requires POSIX Node 24, Azure CLI already installed and an approved
signed-in account. Native Windows support for this new CLI is not validated.
The historical PowerShell helper retains its existing Windows support.

All commands require explicit `--origin '<approved-https-origin>'`,
`--tenant '<tenant-guid>'` and `--api-client '<own-api-app-guid>'`.

```text
node publish.mjs inventory BASE
node publish.mjs upload BASE --file /private/report.html --confirm report.html
node publish.mjs replace BASE --file /private/report.html --confirm report.html --revision <reviewed-revision> --sha256 <reviewed-sha256>
node publish.mjs delete BASE --name report.html --confirm report.html --revision <reviewed-revision> --sha256 <reviewed-sha256>
node publish.mjs restore BASE --name report.html --confirm report.html --revision <reviewed-destination-revision> --sha256 <reviewed-sha256-or-missing> --backup-id <selected-backup-id> --backup-sha256 <selected-backup-sha256>
```

### Produce or supply a version-linked PNG

The host remains zero-dependency and has no browser renderer. On the publisher
machine, either supply a reviewed PNG of the actual report or use the optional
publisher-only `render-thumbnail.mjs` beside `publish.mjs`.

```text
node render-thumbnail.mjs --file /private/report.html --output /private/report-preview.png --playwright-module /absolute/path/to/already-installed/playwright/index.mjs --browser-channel msedge
```

Omit `--playwright-module` if the publisher can already resolve the installed
`playwright` module. This helper never installs it or downloads a browser.
`--browser-channel` can select an already installed `msedge` or `chrome`;
without it, an existing Playwright Chromium must be available. If no suitable
tool is available, capture/supply a reviewed PNG through the approved local
browser workflow instead. Do not copy credentials or attach a user profile.

The helper snapshots the selected HTML, renders a 1200 by 750 viewport in a
fresh nonpersistent headless context, and returns JSON with `htmlSha256`,
PNG `sha256`, dimensions, size and output path. JavaScript and external report
resources are disabled. Self-contained static HTML, CSS and inline data images
can render; script-built charts and externally loaded styles/fonts/images can
be absent. This is not a full-fidelity rendering guarantee. Inspect the PNG
against the actual report before publishing. Reports needing JavaScript can
use an operator-supplied reviewed PNG; there is no script-enabling fallback in
this helper. No report is sent to an external renderer.

The PNG output must be a new file, never an overwritten one. Capture failure
is explicit and publishes nothing. After review, add **both** optional fields
to the upload or reviewed replace command:

```text
node publish.mjs upload BASE --file /private/report.html --confirm report.html --thumbnail /private/report-preview.png --thumbnail-html-sha256 <htmlSha256-from-capture>
node publish.mjs replace BASE --file /private/report.html --confirm report.html --revision <reviewed-revision> --sha256 <reviewed-sha256> --thumbnail /private/report-preview.png --thumbnail-html-sha256 <htmlSha256-from-capture>
```

For a supplied PNG, compute the HTML file's SHA-256 using the local trusted
hash tool and review that the image depicts those exact bytes. Hash binding
prevents version mix-ups; it cannot prove that an arbitrary supplied image
visually represents its claimed HTML. That remains publisher review.
If the HTML changed after capture, publishing fails locally before token
acquisition. Invalid/missing/oversized requested PNGs never silently downgrade
to an HTML-only success. The verified response must confirm the PNG hash and
metadata, not just the HTML.

Accepted PNGs are 1-1600 pixels wide, 1-1200 high and at most 256 KiB. Only
non-animated, non-interlaced 8-bit grayscale, RGB, grayscale-alpha and RGBA are
supported. Indexed palettes, other bit depths, text/EXIF chunks and animation
are refused. Signature, chunk ordering/lengths/CRC, bounded IDAT decompression
and row filters are checked. Small standard color/density chunks are allowed.

Upload/replace without these flags remains compatible. New HTML with no PNG
shows unavailable. Identical HTML preserves its retained image when possible.
A retained filename/HTML-hash association cannot be rebound to a different PNG;
the server rejects that conflict before writing. To supply an image for a
legacy current report, explicitly replace the reviewed version with identical
HTML plus its PNG. Historical backup image fields are not retroactively
invented. A backup with no PNG stays unavailable; if restored, it can then
receive a reviewed PNG through an explicit identical-HTML replacement.

Replace `BASE` with the actual nonsecret argument pairs, not the literal word.
Inventory provides revisions, hashes and backup IDs. For a missing destination,
use its entry in `missingVersions`, or `missing` when no history exists, and
`--sha256 missing`. Upload is create-only. Replace and restore require explicit
review of the selected destination version. Every mutation confirms the exact
filename. One nonempty, safe flat UTF-8 `.html` file, at most 1 MiB, is accepted.
Linked files/parents, hard-linked files and multi-dot names are refused.

The CLI captures `az account get-access-token --scope
api://<app-guid>/publish_as_user` output in memory. It never puts bearer tokens
in arguments, config, files, browser code or diagnostics. It has no automatic
retry. A missing or invalid response is an uncertain outcome, not success.
After such a response, inspect inventory and server transaction evidence before
another mutation. A matching verified response includes its transaction ID,
revision and readback SHA-256.
After verified upload, replace or restore, the CLI also returns the approved
`https://<origin-host>/<flat-name>.html` URL. The `content/` directory is storage,
not part of that public route. Delete results contain no live report URL.

CLI and UI retain only allowlisted service error codes and a validated
structured transaction GUID, never raw provider bodies. Known version, quota,
activation or authorization refusals are definite prewrite denials: this
request made no report change. A lost, invalid or unknown mutation response is
uncertain and requires inventory/evidence inspection without blind retry.
An uncertain service error includes its transaction ID for operator recovery.
Inventory transport failure is not misreported as an uncertain mutation.
Inventory responses are bounded to 16 MiB, enough for the 10,000-transaction
ceiling with maximal legal filenames and metadata.

## Storage protocol and recovery

Every manager process uses the same private `writer.lock` directory, acquired
with exclusive `mkdir`. Upload, replace, delete, restore, inventory and recovery
coordinate through it. There is no age-based stale-lock takeover. This requires
one shared content/state volume across host instances, with working atomic
mkdir/rename and file/directory fsync. Validate those guarantees on the actual
Azure storage volume before activation.
Acquisition waits at most one second (five seconds for thumbnail GETs) for a
normal active holder, so parallel browser image requests do not collide with
each other or a reviewed mutation. This only retries exclusive lock acquisition,
never a mutation or a failed POST. A still-held lock is refused, never removed,
renamed or stolen automatically. Reviewed versions are checked after acquisition.

Under the lock, a mutation checks the reviewed destination revision and SHA-256,
writes and fsyncs a private byte backup, verifies it, stages new bytes and writes
a durable prepare record. It rechecks the destination, atomically renames the
new file into place (or moves a deleted original to private state), syncs both
directories, reads back the effect and records a durable outcome. A completed
record provides actor, action, version, timestamps and hashes. Historical mtime
is never described as upload time.

Optional image evidence uses `before.png` and `after.png` in that same private
transaction directory. The prepare record binds each PNG hash, dimensions and
byte count to its before/after HTML hash. PNGs are durably written and verified
before prepare, then copied with the version during replacement/deletion and
restore. No separate unjournaled image directory or public content file exists.
Recovery verifies every declared PNG before recording a recovered outcome.
Legacy prepare records without PNG fields remain valid.

Thumbnail GET URLs contain an immutable transaction ID, before/after slot and
PNG hash. They require the same manager-plus-reader authorization, return
`image/png`, `nosniff` and `Cache-Control: private, no-store`, and never accept
an arbitrary path. Old/private storage paths are not static routes. Read-only
manager mode can view existing images but cannot supply or alter them.
The optional JSON `thumbnail` input is `{htmlSha256, pngBase64}` on upload or
replace only. HTML and PNG together share a bounded request ceiling, not an
unbounded multipart upload.

A failure after private transaction creation retains its evidence and lock.
Other processes refuse the lock. A lost response must not trigger a blind retry.
An unresolved, orphaned or torn journal blocks subsequent operations. Do not
delete it to make an upload succeed.

Recovery is an offline operator operation:

1. Stop **all** host/manager processes and other writers. Disable hosted
   mutations and keep legacy/manual publishers frozen.
2. Verify that no process owns the abandoned lock. Preserve the private state.
   Move only the known `writer.lock` directory to a private evidence name.
   This manual maintenance action is not an age-based automatic takeover.
3. Run `node recover.mjs --writers-stopped` with the same private configuration.
   It acquires a new lock and never changes live report bytes. If live bytes
   equal the recorded after state, it can record committed; if they equal the
   before state, it can record aborted. It verifies required backups and deleted
   originals. It syncs the live content and transaction directories before
   durably writing any recovered outcome, including a rename-before-sync crash.
   Any third state or damaged journal remains blocked for operator
   review, with all evidence retained.
4. Inspect the result, retained evidence, inventory and report behavior before
   restarting writers or enabling mutations.

The protocol fences cooperating manager processes, **not** Kudu, manual admin
edits or old publisher copies. A stat/hash check cannot fence an external writer
between check and rename. Freezing and migrating every such writer is a required
operational gate, not a claimed filesystem guarantee. The updated legacy
PowerShell helper refuses publishing when either hosted mutation activation or
publisher freeze is set. Its `-Recover` path remains available to close SCM.
Freeze alone means publishing is paused, not that own-API publishing is enabled.
Only active hosted mutations direct publishers to the own-API command.
Old copies cannot enforce this rule; remove their authority operationally.

Retention runs under the same lock during inventory and before mutations. Only resolved transaction
backup/staging files older than 90 days are removed. Superseded audit records
older than 365 days can be removed; current provenance remains. Unresolved
evidence and live content are never retention targets. Limits are 500 managed
pages, 1,000 content entries, 10,000 transaction directories and 512 MiB private
state with reserved capacity for a new transaction. Quota errors require
operator review, not live content deletion.
An idle host has no retention timer; eligible evidence is removed on the next
inventory/mutation, not at an exact wall-clock deadline. Expired backups cannot
be restored even if cleanup has not run. Unresolved evidence is retained until
operator resolution regardless of age.
Expired resolved audit transactions first move atomically into a separate
non-served `retired/` namespace. Both namespace directories are synced before
idempotent deletion. Restarted cleanup syncs them again and resumes deletion
without interpreting partially deleted retired files as an active torn journal.
Retired evidence counts toward the same byte and transaction-count quotas.
PNG evidence counts toward those quotas, including retired bytes and a reserve
for both before/after images. Before PNGs expire with the 90-day backup; old
superseded after PNGs become eligible on the same activity-driven schedule.
The latest committed after PNG stays with current provenance. A retired
transaction includes its images in the same resumable cleanup, with no
orphan-image deletion shortcut. Unresolved PNG evidence is never expired.

## Activation gates

Keep mutations disabled until the host owner verifies all of the following:
own-API CLI issuance and real signature/claim checks; effective delegated Graph
OBO consent and MI-federated execution; EasyAuth bearer admission without
excluding manager paths or weakening browser readers; configured manager
allowlist; same-origin trust approval; durable shared storage and crash recovery;
legacy/manual publisher freeze/migration; and independent source review.
Deploying this host application is separate from uploading a report.
Do not treat a token issuance test as proof that OBO or the manager is deployed.

## Offline checks and limits

From the repository root, set `PUBLISH_HTML_TEST_ARTIFACT_DIR` to an approved
existing artifact directory outside the checkout, then run:

```text
node --test plugins/mnmstack/skills/publish-html/scripts/hosted-manager/test/*.test.mjs plugins/mnmstack/skills/publish-html/scripts/upload-html.test.mjs
```

Tests use synthetic keys/users, injected auth transport, isolated private state,
loopback HTTP and real duplicate writer processes. They make no cloud calls,
read no real user config and require no packages. They are not real browser,
native Windows CLI, Azure filesystem, OBO consent, tenant policy, deployment or
live access-policy validation. Those remain explicit activation gates.
PNG tests use actual bounded PNG containers, corrupt/mismatched inputs,
concurrent same-HTML writers, private authenticated lookup, restore,
retention/quota and crash recovery. Optional publisher browser capture still
needs separate local browser availability and visual review.
