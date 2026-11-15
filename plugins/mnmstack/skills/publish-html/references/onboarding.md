# Set up an HTML publisher

Use `htmlpub setup` for guided onboarding, as described in
[htmlpub.md](htmlpub.md). The same engine remains available through
`htmlpub setup plan|apply|status|recover|evidence` or `scripts/setup-html.mjs`
for automation. Run setup only when the user has asked to set up a publisher.
It can create or reuse the required resources and records a private inventory
from the first attempt. Installing the skill or publishing a report never runs
setup. `upload-html.ps1 -Init` remains an existing-host capture command, not
infrastructure onboarding.

## Prerequisites and selections

The setup CLI targets public Azure, one selected subscription/resource group,
a single workforce tenant and Linux App Service with Node.js 24. It uses
Node.js 24 and an already installed, signed-in Azure CLI on macOS, Linux or
Windows. The Windows path requires the standard Azure CLI installation and its
bundled `python.exe`; it never constructs a shell command for `az.cmd`.
No automatic sign-in, extension/package installation or CLI default changes
are allowed. Windows setup contracts are mocked; native Windows execution
has not been validated. The own-API publisher remains POSIX-only.

Create a private request based on
[onboarding-request.example.json](../templates/onboarding-request.example.json).
Replace the placeholders with your selected tenant, subscription, region and
resource names. Choose a paid Linux plan SKU and get approval for its costs.
The sample uses `B1`; it does not authorize spending.

For each resource, choose `create` with a name, or `reuse` with a name and its
exact observed ARM ID/directory object GUID. All selected ARM resources must
be in the selected resource group. Registration IDs are object IDs, not client
IDs. Reader groups must be non-mail security groups. Manager users and
delegated client applications must already exist. Supply their exact IDs;
setup verifies these references. The owner must check each person's actual access.
New reader groups are empty. Group membership remains an owner operation.

Reuse does not authorize migration or access expansion. Reused registrations
must already expose the correct callback, v2 `publish_as_user` scope and
delegated Graph permission, and trust the selected managed identity through
the exact federation credential. Reused sites must already match the protected
tenant/corporate/secretless policy and selected identity/plan. Setup can verify
and reuse an exact hash-named runtime release; it refuses an unrelated startup
or unmanaged application deployment. Resolve incompatible reuse with the host
owner in a separate reviewed workflow.

The selected managed identity must not grant an unrelated workload access to
this registration. Review its assignments and the volume/administrator access
boundary as part of source/trust acceptance. Setup does not grant itself
directory roles or ARM roles to overcome missing authority.

## Plan and apply one stage

Resolve the script relative to the loaded skill directory. These examples use
that directory as the working directory. All paths refer to private locations
outside Git checkouts.

```text
node scripts/setup-html.mjs plan --request <private-request.json> --config <private-resources.json> --stage resources
node scripts/setup-html.mjs apply --config <private-resources.json> --stage resources --approve <reviewed-preview-sha256>
node scripts/setup-html.mjs status --config <private-resources.json>
```

`plan` contacts the selected Azure/Graph metadata. `status` is local.
The inventory is saved before the first cloud read. Plan does not create
resources or change cloud settings. An access denial is not resource absence.
Review the exact generated operation and effects before apply. A preview
expires after 15 minutes; apply rechecks the target and refuses drift.
The digest binds scope, not authenticated user authorization. Obtain explicit
human/tool permission for access changes, consent, deployments, restarts,
diagnostics and activation, even when a digest is available.

Repeat `resources` plan/apply until all resources are observed. Each apply
creates at most one resource so returned IDs can be reviewed before a dependent
operation. New sites start with public access disabled, HTTPS required and
deny-by-default ingress/SCM. If a name is taken, setup stops without adopting
that resource.
Then use these finite stages:

| Stage | Effect |
| --- | --- |
| `identity` | Configures owned registration/federation, exact EasyAuth audience, MI settings, explicit reader/manager IDs and corporate-only ingress. Mutations stay disabled; appsettings can restart the app. |
| `consent` | Adds one exact delegated Graph `User.Read` or selected client's `publish_as_user` grant per approval. Repeat until the planner reports existing exact grants. No broad admin-consent command or application Graph permissions. |
| `deployment` | Reviews and stages the exact runtime file manifest, including `start-host.mjs`, then verifies remote bytes and selects startup. It temporarily permits corporate-only SCM and must restore the original deny-only rules. No report-directory cleanup or application dependencies are installed. |
| `diagnostics` | Creates/reuses a selected workspace, then separately configures exact log routing and trace settings. Included by default in new guided requests; structured requests keep their explicit choice. |
| `acceptance` | Reads manager inventory through the delegated bearer publisher on the selected host with the verified matching runtime. Inventory retention can change host state. No native sign-in, automatic retry or fallback. |
| `activation` | Enables mutations only after a fresh real publisher check and all required target-bound evidence. Every legacy/manual writer must be frozen. |

Routine publication never runs one of these stages. Do not copy a preview
from another config, change a request to evade a refusal or claim provisioning
is acceptance. The known native EasyAuth failure is not repaired by onboarding.

## Private inventory and recovery

The default inventory is `~/.copilot/html-publisher/resources.json`.
Legacy `config.json`, adjacent recovery records, locks and backups are unchanged.
Choose an explicit `--config` if the default is inside a Git-managed home or
`.copilot` directory. Setup refuses all repository/plugin paths, linked paths,
shared POSIX permissions or unsupported Windows DACLs.
Request/evidence JSON files require the same private path protection.
Create their private parent in advance. POSIX files/directories require modes
0600/0700. Windows files/directories must exclude inherited/shared access;
current-user access and legitimate SYSTEM/local Administrator grants are
accepted. Unsupported ACL checks fail closed. Local administrators are not
excluded by this model. Never copy identifiers into the public template.

The [inventory schema](../templates/resource-inventory.schema.json) records
desired selections separately from actual observations, IDs/types/regions,
relationships, created/reused/external ownership, timestamps and sources.
Unknown values stay null/unverified. Content, private-state and runtime release
paths are filesystem locations on the App Service volume, not newly created
Azure Storage accounts. Existing attached-volume metadata is recorded without
access keys. Diagnostics capture stays unverified until separately evidenced.

State writes retain a previous revision. A local exclusive lock fences only
cooperating setup processes using this config, not administrators, other
configs or other machines. Coordinate one setup/deployment owner per host.
An interrupted process can leave its lock; verify that no owner exists and
preserve the lock/state as evidence before an explicitly approved local lock
removal. Never steal an old lock automatically.

```text
node scripts/setup-html.mjs recover --config <private-resources.json>
node scripts/setup-html.mjs recover --config <private-resources.json> --approve <reviewed-recovery-sha256>
```

Recovery closes and verifies original SCM restrictions, or reconciles an
uncertain resource/identity/consent submission through metadata without retrying
its writes. Only matching creation provenance can reconcile a new resource.
Missing or partial results stay blocked. Preserve the partial release, previous
startup and all config revisions. Recovery does not undo report bytes or claim
that a startup rollback occurred. A failed runtime stage with SCM already
closed still requires owner review/reconciliation; there is no blind redeploy.
For a selected candidate runtime, the recovery preview includes a temporary
corporate-only SCM opening for exact release readback, followed by verified
closure. It never redeploys files or restarts the app. An unselected partial
release is retained and recorded as unselected, not called ready.
Setup has no teardown and never deletes created, reused or shared resources.

To select an existing legacy config explicitly, use the optional absolute
`legacyConfig` request field. Pending legacy SCM recovery blocks setup.
Run its original helper with that config; do not delete recovery evidence or
initialize a new config to bypass policy drift.

## Acceptance and routine publishing

Successful token issuance, local signature checks or source tests cannot clear
publisher acceptance. The script must observe a real delegated bearer manager inventory
with hosted mutations disabled. A failure records a failed gate and keeps
activation blocked. It does not expose raw tokens, cookies, headers or provider
bodies. This publisher does not create a native session or change its
provider-token state through the older sign-in endpoint.

`status` returns the current target hash and all pending gates. For the other
gates, record owner-reviewed evidence with an exact target hash, bounded
reference and actual check time:

```json
{
  "version": 1,
  "targetSha256": "<current-status-target-sha256>",
  "checks": [
    {
      "gate": "browser-reader-manager",
      "result": "passed",
      "checkedAt": "<actual-UTC-check-time>",
      "reference": "<private-evidence-reference-with-no-secrets>"
    }
  ]
}
```

```text
node scripts/setup-html.mjs evidence --config <private-resources.json> --evidence <private-evidence.json>
```

Additional required gates are `browser-denials`, `corporate-ingress`,
`storage-durability-recovery`, `trusted-origin-review`,
`legacy-writers-frozen` and `source-review`. They are labeled owner attestations,
not automatic validations. Include actual reader/manager authorization,
non-entitled denial and the shared-volume atomic/fsync/crash-recovery results,
not just configuration screenshots. External-account failure due to that
account's own policy does not prove this app rejected it. Same-origin trusted
report JavaScript retains the signed-in user's application privileges.
The browser has no upload/replace form.

Owner evidence cannot set `native-manager-obo`, the retained schema key for
the automated publisher check. Only a successful real publisher probe on the
matching verified runtime can set it. Old `native-probe` session evidence does
not approve this protocol. Evidence expires after 24 hours
or when the selected resources, policy, dependencies or runtime change.
After separate activation, use the POSIX publisher with:

```text
node scripts/hosted-manager/publish.mjs inventory --config <private-resources.json>
node scripts/hosted-manager/publish.mjs upload --config <private-resources.json> --file <private-report.html> --confirm report.html
```

Do not mix config and explicit origin/tenant/client options. The existing
explicit-argument protocol remains supported. Config loading validates
acceptance/activation before mutations and never runs setup. Server-side
authorization/activation remains authoritative.

## Diagnostics selection

New guided plans include diagnostics by default, with disclosure and explicit
operation approval. Choose Change settings to turn them off before applying. Resuming
an existing saved request never silently enables them. Structured requests
retain their explicit `off`/`enabled` choice. To enable them in a structured
request, set `diagnostics.mode` to `enabled` and select `workspace` with
create/reuse mode, name and ID for reuse, `settingName`, `retentionDays`
(30-730) and `dailyQuotaGb` (greater than zero, at most 100). A workspace can
incur charges before routing is enabled. Setup uses resource-specific
`AppServiceAuthenticationLogs` routing only when supported and does not
overwrite a conflicting named setting or unrelated destinations.

Enabling trace settings can restart the app. Export and ingestion can incur
charges and retain sensitive records for other users. Inherited workspace
access and networking still apply; a personal-sounding name does not make
records exclusive. A quota is not a hard spending limit. Workspace creation
and routing verification are not proof that logs arrived. Setup does not read
raw logs or automatically add diagnostic access.

## Source checks and platform limits

Set `PUBLISH_HTML_TEST_ARTIFACT_DIR` to an approved existing private directory
outside all Git checkouts, then run:

```text
node --test scripts/htmlpub*.test.mjs scripts/onboarding.test.mjs scripts/upload-html.test.mjs scripts/hosted-manager/test/*.test.mjs
```

Tests use injected process/network transports, synthetic IDs and real local
state/recovery files. They do not read user Azure config or contact services.
Real POSIX PTY tests use Python 3's standard library to send arrow keys, Space,
Esc and Ctrl+C. They check selection, exact approvals, saved drafts, resume,
colors and terminal cleanup. No extra production dependency is needed.
The package regression uses npm offline to pack and install into a disposable
private prefix, checks that tests/fixtures are excluded, then drives its real
bin through a long-alias setup prompt. It does not install into the user's
normal prefix or use their npm/Azure config.
Windows launch/DACL contracts are mocked on POSIX. Native Windows execution,
Azure filesystem/deployment behavior, real consent/OBO/native authentication,
corporate ingress and browser authorization remain separately approved live
acceptance tasks, not claims made by these tests.

Platform references: [Node 24](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs),
[secretless EasyAuth](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-aad#use-a-managed-identity-instead-of-a-secret),
[MI federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-config-app-trust-managed-identity),
[delegated OBO](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow),
[file deployment](https://learn.microsoft.com/en-us/azure/app-service/deploy-zip)
and [authentication logs](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/appserviceauthenticationlogs).
