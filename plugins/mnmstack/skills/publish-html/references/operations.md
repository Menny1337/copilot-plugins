# Upload one HTML file

Use `scripts/upload-html.ps1` with an existing approved host. Resolve the path from the loaded skill directory. The command examples below assume the working directory is that skill's `scripts` directory. It does not provision resources or change the host's authentication settings.

This POC is supported on Windows with PowerShell 7.2 or later, the standard Azure CLI MSI installation on PATH, an Azure sign-in, corporate connectivity, and deployment permissions.
Keep the config, recovery files and backups in a private local directory.

## Set up once

Run this after the host owner approves its tenant, registration and group allowlist:

```powershell
.\upload-html.ps1 -Init -SubscriptionId '<subscription-guid>' -ResourceGroup '<resource-group>' -AppName '<existing-app>'
```

Initialization reads Azure and creates `%USERPROFILE%\.copilot\html-publisher\config.json`.
It does not upload content, select a subscription, overwrite an existing config, or make cloud changes.
Use `-Config '<path>\config.json'` on every command to choose another location.

`templates/config.example.json`, relative to the skill root, illustrates the shape. Do not copy it as working configuration.
Use `-Init` to capture the host's identifiers and expected access policy, including exact ingress rules and an authentication-settings fingerprint.
The config contains no tokens, cookies or publishing secrets.

The host must already have:

- its default Azure hostname, HTTPS-only traffic and enabled public network access
- mandatory Entra authentication, a tenant-specific issuer, the registration client ID as its sole configured audience, and no excluded paths
- the existing secretless managed identity setup, enabled token store and 1 to 20 allowed group GUIDs
- corporate-only reader ingress through `CorpNetPublic`, with default deny
- separate SCM restrictions with default deny and no allow rules
- disabled SCM basic publishing authentication

After an approved policy change, first recover any unfinished upload. Keep the old config for reference, then initialize a new config.
Do not recapture unexpected drift merely to bypass a refusal.

## Upload or replace

```powershell
.\upload-html.ps1 -File '.\report.html'
.\upload-html.ps1 -File '.\report.html' -Overwrite
```

Use a nonempty UTF-8 HTML document up to 1 MiB. Names must match `^[A-Za-z0-9][A-Za-z0-9_-]*\.html$`.
The helper rejects local symlinks, linked parent directories, directories and invalid UTF-8.
It preserves the HTML bytes and normal JavaScript features. Self-contained reports are simplest; referenced assets are not bundled or uploaded by this command.

Each upload:

1. Checks the host against the config before changing SCM.
2. Saves recovery information, then allows corporate SCM access.
3. Reads the target through Kudu using an in-memory Entra ARM bearer token.
4. Refuses an existing target unless you specify `-Overwrite`.
5. Saves the previous HTML under `backups\<timestamp-and-id>\<original-name>` beside the config.
6. Deploys only `/home/site/wwwroot/content/<name>`, with `clean=false` and `restart=false`.
7. Checks the remote byte length and SHA-256 hash.
8. Restores and verifies the original closed SCM restrictions, then checks host policy again.

The host maps files stored under `wwwroot/content/` to the public root route, so
the shareable URL is `https://<hostname>/<name>`, not `/content/<name>`.
The helper prints the backup path when one exists, including after a failed upload.
For manual rollback, upload that backup with `-Overwrite`. Keep its original filename.
The helper does not restore HTML automatically if deployment or verification fails.

## Recover after interruption

```powershell
.\upload-html.ps1 -Recover
# With a custom config:
.\upload-html.ps1 -Recover -Config '.\publisher\config.json'
```

A failed restoration or forced process termination can leave SCM open to corporate traffic.
The helper leaves `<config>.recovery.json` so you can restore the saved deny-only SCM rules.
Recovery changes only SCM restrictions. It does not require an unchanged authentication policy, which could otherwise prevent emergency closure.
Keep the recovery file until recovery succeeds. It blocks further uploads and initialization at that config path.

## Limits

- Use one config per host. The file lock coordinates processes using that config on one machine, not other configs, machines or deployers.
- Other administrators can change Azure between checks. This helper does not provide an atomic deployment, distributed lock or policy transaction. If authentication changes during publishing, the uploaded file may remain live under the changed policy; the helper reports the mismatch but does not delete content or change the reader policy. Coordinate with the host owner and resolve drift before sharing.
- A forced stop can leave local `.upload-*` or body files beside the config. After recovery, remove abandoned files when no upload is running.
- Corporate SCM restriction changes can take time to propagate. A failed Kudu read restores SCM; retry the upload after checking connectivity.
- Only upload trusted first-party code. Review active content and external dependencies. This helper does not parse or sanitize HTML, sandbox JavaScript, or prove that a report is safe or self-contained.
- The approved host must retain a regular content directory and regular remote files. The VFS byte check does not establish remote filesystem link metadata.
- The helper does not attest application code, registration consent or live group authorization. Test those through the signed-in browser.
- Azure CLI must support Entra-authenticated static deployment when SCM basic publishing is disabled. The helper does not request publishing keys itself.
- Host owners remain responsible for application authorization and acceptance testing. A reusable upload command is not evidence that every audience, token-expiry, or entitlement-revocation scenario has been exercised.

Run the offline tests from the skill root on Windows:

```powershell
node --test .\scripts\upload-html.test.mjs
```

Tests replace Azure and Kudu entrypoints. They make no cloud calls or changes.
