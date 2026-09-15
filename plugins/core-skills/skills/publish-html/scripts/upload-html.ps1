#requires -Version 7.2
[CmdletBinding(DefaultParameterSetName = 'Upload')]
param(
    [Parameter(ParameterSetName = 'Upload')][string] $File,
    [Parameter(ParameterSetName = 'Upload')][switch] $Overwrite,
    [Parameter(Mandatory, ParameterSetName = 'Init')][switch] $Init,
    [Parameter(Mandatory, ParameterSetName = 'Init')][string] $SubscriptionId,
    [Parameter(Mandatory, ParameterSetName = 'Init')][string] $ResourceGroup,
    [Parameter(Mandatory, ParameterSetName = 'Init')][string] $AppName,
    [Parameter(Mandatory, ParameterSetName = 'Recover')][switch] $Recover,
    [string] $Config = [IO.Path]::Combine([Environment]::GetFolderPath('UserProfile'), '.copilot', 'html-publisher', 'config.json')
)
$ErrorActionPreference = 'Stop'

function ConvertTo-Canonical($Value) {
    function Sort-Value($v) {
        if ($v -is [System.Collections.IDictionary]) {
            $ordered = [ordered]@{}
            foreach ($key in ($v.Keys | Sort-Object)) { $ordered[$key] = Sort-Value $v[$key] }
            return $ordered
        }
        if ($v -is [array]) { return ,@($v | ForEach-Object { Sort-Value $_ }) }
        return $v
    }
    ConvertTo-Json -InputObject (Sort-Value $Value) -Depth 40 -Compress
}

function Assert-Identifiers($c) {
    $guid = '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
    if ($c.subscriptionId -notmatch $guid -or $c.resourceGroup -cnotmatch '^[A-Za-z0-9_()-][A-Za-z0-9_().()-]{0,89}$' -or
        $c.resourceGroup.EndsWith('.') -or $c.appName -cnotmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,58}[a-zA-Z0-9]$') {
        throw 'Specify a subscription GUID, resource group, and existing app name (not URLs).'
    }
}

function Invoke-Azure([string[]] $Arguments) {
    $az = Get-Command az -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $argsScoped = @($Arguments) + @('--subscription', $script:Publisher.subscriptionId, '--only-show-errors')
    # Windows az.cmd can corrupt JSON quoting. Use its own bundled interpreter if available.
    $python = Join-Path (Split-Path (Split-Path $az.Source -Parent) -Parent) 'python.exe'
    if ($az.Source.EndsWith('.cmd')) {
        if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
            throw 'This Windows Azure CLI launcher has no bundled python.exe. Use the standard Azure CLI MSI installation.'
        }
        $output = & $python -IBm azure.cli @argsScoped 2>$null
    } else {
        $output = & $az.Source @argsScoped 2>$null
    }
    if ($LASTEXITCODE -ne 0) { throw "Azure operation failed ($($Arguments[0..1] -join ' ')), exit code $LASTEXITCODE. Raw CLI diagnostics suppressed to protect credentials." }
    if ($output) {
        try { return ($output -join "`n") | ConvertFrom-Json -AsHashtable }
        catch { throw 'Azure CLI returned invalid JSON. Response omitted to protect credentials.' }
    }
}

function Invoke-Arm([string] $Suffix = '', [string] $Method = 'GET', $Body = $null) {
    $url = "https://management.azure.com/subscriptions/$($script:Publisher.subscriptionId)/resourceGroups/$($script:Publisher.resourceGroup)/providers/Microsoft.Web/sites/$($script:Publisher.appName)$Suffix`?api-version=2024-11-01"
    $arguments = @('rest', '--method', $Method, '--url', $url, '--resource', 'https://management.azure.com/', '--output', 'json')
    $bodyPath = $null
    try {
        if ($null -ne $Body) {
            $bodyPath = "$($script:ConfigPath).body-$([guid]::NewGuid().ToString('N')).json"
            Write-NewJson $bodyPath $Body
            $arguments += @('--body', "@$bodyPath")
        }
        Invoke-Azure $arguments
    } finally {
        if ($bodyPath -and (Test-Path -LiteralPath $bodyPath)) { Remove-Item -LiteralPath $bodyPath }
    }
}

function Write-NewJson([string] $Path, $Value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 40))
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes); $stream.Flush($true) } finally { $stream.Dispose() }
}

function Get-Scm($web) {
    @{
        scmIpSecurityRestrictions = @($web.scmIpSecurityRestrictions)
        scmIpSecurityRestrictionsDefaultAction = $web.scmIpSecurityRestrictionsDefaultAction
        scmIpSecurityRestrictionsUseMain = $web.scmIpSecurityRestrictionsUseMain
    }
}

function Assert-ClosedScm($scm) {
    if ($scm.scmIpSecurityRestrictionsDefaultAction -ne 'Deny' -or
        $scm.scmIpSecurityRestrictionsUseMain -cne $false -or
        @($scm.scmIpSecurityRestrictions | Where-Object { $_.action -ne 'Deny' }).Count) {
        throw 'SCM must have default Deny, no allow rules, and inheritance disabled.'
    }
}

function Get-ApprovedPolicy {
    $site = (Invoke-Arm).properties
    $auth = (Invoke-Arm '/config/authsettingsV2').properties
    $web = (Invoke-Arm '/config/web').properties
    $basic = (Invoke-Arm '/basicPublishingCredentialsPolicies/scm').properties
    if ($basic.allow -cne $false) { throw 'SCM basic publishing must already be disabled; this helper only permits Entra deployment authentication.' }
    $settings = Invoke-Azure @('webapp', 'config', 'appsettings', 'list', '--resource-group', $script:Publisher.resourceGroup,
        '--name', $script:Publisher.appName, '--query',
        "[?name=='TENANT_ID' || name=='ALLOWED_GROUP_IDS' || name=='OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID']", '--output', 'json')
    $tenant = @($settings | Where-Object name -eq 'TENANT_ID').value
    $groups = @((@($settings | Where-Object name -eq 'ALLOWED_GROUP_IDS').value -split ',') | ForEach-Object { $_.Trim().ToLowerInvariant() } | Sort-Object)
    $identity = @($settings | Where-Object name -eq 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID').value
    $aad = $auth.identityProviders.azureActiveDirectory
    $guid = '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
    if ($tenant -notmatch $guid -or $aad.registration.clientId -notmatch $guid -or $identity -notmatch $guid -or
        $groups.Count -lt 1 -or $groups.Count -gt 20 -or @($groups | Where-Object { $_ -notmatch $guid }).Count -or
        @($groups | Select-Object -Unique).Count -ne $groups.Count) { throw 'Invalid tenant, client, identity, or allowed groups.' }
    if ($site.defaultHostName -cnotmatch ("^" + [regex]::Escape($script:Publisher.appName.ToLowerInvariant()) + '(?:-[a-z0-9]+)?(?:\.[a-z0-9-]+)?\.azurewebsites\.net$') -or
        $site.defaultHostName -like '*.scm.*' -or $site.httpsOnly -cne $true -or $site.publicNetworkAccess -ne 'Enabled') {
        throw 'Host must be its own public-Azure default hostname, HTTPS-only, with corporate ingress enabled.'
    }
    if ($auth.platform.enabled -cne $true -or $auth.globalValidation.requireAuthentication -cne $true -or
        @($auth.globalValidation.excludedPaths).Count -ne 0 -or
        $auth.globalValidation.unauthenticatedClientAction -ne 'RedirectToLoginPage' -or
        $auth.globalValidation.redirectToProvider -ne 'azureactivedirectory' -or
        @($auth.login.allowedExternalRedirectUrls).Count -ne 0 -or $auth.httpSettings.requireHttps -cne $true -or
        $aad.enabled -cne $true -or $aad.registration.openIdIssuer -cne "https://login.microsoftonline.com/$tenant/v2.0" -or
        $aad.registration.clientSecretSettingName -ne 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID' -or
        @($aad.validation.allowedAudiences).Count -ne 1 -or $aad.validation.allowedAudiences[0] -ne $aad.registration.clientId -or
        $auth.login.tokenStore.enabled -cne $true -or
        $auth.httpSettings.forwardProxy.convention -notin @($null, 'NoProxy')) { throw 'Mandatory Entra authentication policy is unsafe or unsupported.' }
    $allows = @($web.ipSecurityRestrictions | Where-Object action -eq 'Allow')
    if ($web.ipSecurityRestrictionsDefaultAction -ne 'Deny' -or $allows.Count -ne 1 -or
        $allows[0].ipAddress -ne 'CorpNetPublic' -or $allows[0].tag -ne 'ServiceTag' -or
        @($web.ipSecurityRestrictions | Where-Object { $_.action -notin @('Allow', 'Deny') }).Count) {
        throw 'Readers must be restricted to CorpNetPublic with default Deny.'
    }
    Assert-ClosedScm (Get-Scm $web)
    # Keep only identifiers and expected access policy, never complete auth/appsettings responses.
    @{
        hostname = $site.defaultHostName
        tenantId = $tenant
        clientId = $aad.registration.clientId
        managedIdentityClientId = $identity
        allowedGroupIds = $groups
        issuer = $aad.registration.openIdIssuer
        audiences = @($aad.validation.allowedAudiences)
        excludedPaths = @($auth.globalValidation.excludedPaths)
        loginParameters = @($aad.login.loginParameters)
        authSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes((ConvertTo-Canonical $auth))))
        readers = @($web.ipSecurityRestrictions)
        readersDefault = $web.ipSecurityRestrictionsDefaultAction
        scm = Get-Scm $web
    }
}

function Read-Html([string] $Path) {
    $source = Get-Item -LiteralPath $Path -Force
    $ancestor = $source
    while ($ancestor) {
        if ($ancestor.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Symlinks and reparse-point paths are not supported.' }
        $ancestor = if ($ancestor -is [IO.FileInfo]) { $ancestor.Directory } else { $ancestor.Parent }
    }
    if ($source -isnot [IO.FileInfo] -or $source.Name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]*\.html$' -or
        $source.Length -lt 1 -or $source.Length -gt 1MB) { throw 'Use a nonempty regular .html file, flat safe name, at most 1 MiB.' }
    $bytes = [IO.File]::ReadAllBytes($source.FullName)
    if ($bytes.Length -lt 1 -or $bytes.Length -gt 1MB) { throw 'HTML size changed or exceeds 1 MiB.' }
    try { $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes) } catch { throw 'HTML must be valid UTF-8.' }
    if ($text.Contains([char]0) -or $text -notmatch '(?is)<(?:!doctype\s+html|html)(?:\s|>)') { throw 'File is not a UTF-8 HTML document.' }
    @{ name = $source.Name; bytes = $bytes; sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)) }
}

function Get-ScmHostname([string] $hostname) {
    $scmHost = $hostname -replace '\.azurewebsites\.net$', '.scm.azurewebsites.net'
    # Modern unique default hostnames place SCM before the region component.
    if ($hostname -match '^([^.]+)\.([^.]+)\.azurewebsites\.net$') { $scmHost = "$($Matches[1]).scm.$($Matches[2]).azurewebsites.net" }
    return $scmHost
}

function Invoke-KuduRead([string] $Name, [string] $Token) {
    if ($Name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]*\.html$') { throw 'Unsafe content name.' }
    $scmHost = Get-ScmHostname $script:Publisher.expected.hostname
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    $deadline = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(60))
    $response = $null
    try {
        $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Token)
        $response = $client.GetAsync("https://$scmHost/api/vfs/site/wwwroot/content/$Name", [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
        if ([int]$response.StatusCode -eq 404) { return @{ exists = $false } }
        if ([int]$response.StatusCode -ne 200) { throw 'Kudu read failed (check corporate connectivity and Entra deployment permissions).' }
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $buffer = [byte[]]::new(1MB + 1)
        $length = 0
        do {
            $read = $inputStream.ReadAsync($buffer, $length, $buffer.Length - $length, $deadline.Token).GetAwaiter().GetResult()
            $length += $read
        } while ($read -gt 0 -and $length -lt $buffer.Length)
        if ($length -gt 1MB) { throw 'Remote content exceeds the supported backup/readback limit.' }
        $bytes = [byte[]]::new($length)
        [Array]::Copy($buffer, $bytes, $length)
        @{ exists = $true; bytes = $bytes }
    } catch {
        throw 'Kudu read failed; no credentials or response body have been logged.'
    } finally {
        if ($response) { $response.Dispose() }
        $deadline.Dispose()
        $client.Dispose()
    }
}

function Restore-Scm($record) {
    if ($record.version -ne 1 -or $record.subscriptionId -ne $script:Publisher.subscriptionId -or
        $record.resourceGroup -ne $script:Publisher.resourceGroup -or $record.appName -ne $script:Publisher.appName) {
        throw 'Recovery file does not match this host.'
    }
    Assert-ClosedScm $record.scm
    $scm = Get-Scm $record.scm
    $null = Invoke-Arm '/config/web' 'PATCH' @{ properties = $scm }
    $observed = Get-Scm (Invoke-Arm '/config/web').properties
    if ((ConvertTo-Canonical $scm) -cne (ConvertTo-Canonical $observed)) { throw 'SCM restoration not confirmed; keep recovery file and run -Recover.' }
    Remove-Item -LiteralPath "$($script:ConfigPath).recovery.json"
}

function Invoke-Publisher {
    $script:ConfigPath = [IO.Path]::GetFullPath($Config)
    $parent = Split-Path $script:ConfigPath -Parent
    if (-not $Init -and -not (Test-Path -LiteralPath $script:ConfigPath -PathType Leaf)) {
        throw 'Config missing. First run: .\upload-html.ps1 -Init -SubscriptionId <GUID> -ResourceGroup <RG> -AppName <APP> [-Config <path>]. Initialization only reads the existing approved host.'
    }
    if ($Init -and (Test-Path -LiteralPath $script:ConfigPath)) { throw 'Config already exists; initialization never overwrites it.' }
    if (-not (Test-Path -LiteralPath $parent)) { $null = [IO.Directory]::CreateDirectory($parent) }
    $lock = $null
    $stage = $null
    try {
        try { $lock = [IO.File]::Open("$($script:ConfigPath).lock", [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch { throw 'Another local uploader owns this config lock. Use the same config for this host.' }
        if ($Init) {
            $script:Publisher = @{ subscriptionId = $SubscriptionId; resourceGroup = $ResourceGroup; appName = $AppName; version = 1 }
        } else {
            $script:Publisher = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json -AsHashtable
            if ($script:Publisher.version -ne 1) { throw 'Unsupported config version.' }
        }
        Assert-Identifiers $script:Publisher
        $recoveryPath = "$($script:ConfigPath).recovery.json"
        if ($Recover) {
            if (-not (Test-Path -LiteralPath $recoveryPath)) { throw 'No pending recovery for this config.' }
            Restore-Scm (Get-Content -LiteralPath $recoveryPath -Raw | ConvertFrom-Json -AsHashtable)
            Write-Output 'Original closed SCM policy restored and verified.'
            return
        }
        if (Test-Path -LiteralPath $recoveryPath) { throw 'Unfinished upload detected. Run -Recover with this config before uploading or initializing.' }
        if (-not $Init) {
            if (-not $File) { throw 'Specify -File <document.html>, or use -Init or -Recover separately.' }
            $html = Read-Html $File
        }
        $policy = Get-ApprovedPolicy
        if ($Init) {
            $script:Publisher.expected = $policy
            Write-NewJson $script:ConfigPath $script:Publisher
            Write-Output "Created config for existing approved host $($policy.hostname). No cloud settings changed."
            return
        }
        if ((ConvertTo-Canonical $script:Publisher.expected) -cne (ConvertTo-Canonical $policy)) { throw 'Host access policy drifted from config; no upload or SCM change performed.' }
        $stage = Join-Path $parent ('.upload-' + [guid]::NewGuid().ToString('N'))
        $null = [IO.Directory]::CreateDirectory($stage)
        $stagedFile = Join-Path $stage $html.name
        [IO.File]::WriteAllBytes($stagedFile, $html.bytes)
        $record = @{
            version = 1; subscriptionId = $script:Publisher.subscriptionId
            resourceGroup = $script:Publisher.resourceGroup; appName = $script:Publisher.appName
            scm = $policy.scm
        }
        Write-NewJson $recoveryPath $record
        $backup = $null
        $token = $null
        try {
            $temporary = @{
                scmIpSecurityRestrictions = @(
                    @{ ipAddress = 'CorpNetPublic'; tag = 'ServiceTag'; action = 'Allow'; priority = 100; name = 'HtmlPublisher' }
                    @{ ipAddress = 'Any'; action = 'Deny'; priority = 2147483647; name = 'Deny all' }
                )
                scmIpSecurityRestrictionsDefaultAction = 'Deny'; scmIpSecurityRestrictionsUseMain = $false
            }
            $null = Invoke-Arm '/config/web' 'PATCH' @{ properties = $temporary }
            $opened = (Invoke-Arm '/config/web').properties
            $openedAllows = @($opened.scmIpSecurityRestrictions | Where-Object action -eq 'Allow')
            if ($opened.scmIpSecurityRestrictionsDefaultAction -ne 'Deny' -or $opened.scmIpSecurityRestrictionsUseMain -cne $false -or
                $openedAllows.Count -ne 1 -or $openedAllows[0].ipAddress -ne 'CorpNetPublic' -or $openedAllows[0].tag -ne 'ServiceTag' -or
                (ConvertTo-Canonical @($opened.ipSecurityRestrictions)) -cne (ConvertTo-Canonical $policy.readers) -or
                $opened.ipSecurityRestrictionsDefaultAction -ne 'Deny') { throw 'Temporary SCM or reader restrictions were not confirmed.' }
            $token = (Invoke-Azure @('account', 'get-access-token', '--resource', 'https://management.azure.com/', '--query', '{token:accessToken,tenant:tenant}', '--output', 'json'))
            if ($token.tenant -ne $policy.tenantId -or -not $token.token) { throw 'ARM token tenant does not match approved host.' }
            $previous = Invoke-KuduRead $html.name $token.token
            if ($previous.exists -and -not $Overwrite) { throw 'Destination exists. Use -Overwrite to back it up and replace it.' }
            if ($previous.exists) {
                $backupDir = [IO.Path]::Combine($parent, 'backups', (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N'))
                $null = [IO.Directory]::CreateDirectory($backupDir)
                $backup = Join-Path $backupDir $html.name
                [IO.File]::WriteAllBytes($backup, $previous.bytes)
            }
            $result = Invoke-Azure @('webapp', 'deploy', '--resource-group', $script:Publisher.resourceGroup, '--name', $script:Publisher.appName,
                '--src-path', $stagedFile, '--type', 'static', '--target-path', "/home/site/wwwroot/content/$($html.name)",
                '--clean', 'false', '--restart', 'false', '--track-status', 'false', '--enable-kudu-warmup', 'false',
                '--timeout', '180000', '--output', 'json')
            if ($result.status -ne 4 -or $result.complete -cne $true) { throw 'Deployment did not report complete success.' }
            $remote = Invoke-KuduRead $html.name $token.token
            if (-not $remote.exists -or $remote.bytes.Length -ne $html.bytes.Length -or
                [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$remote.bytes)) -cne $html.sha256) { throw 'Remote byte length/SHA-256 verification failed; inspect backup for manual rollback.' }
        } finally {
            $token = $null
            if ($backup) { Write-Output "Previous HTML backup (manual rollback): $backup" }
            Restore-Scm $record
        }
        $after = Get-ApprovedPolicy
        if ((ConvertTo-Canonical $policy) -cne (ConvertTo-Canonical $after)) { throw 'SCM restored, but host policy drifted during upload; investigate before sharing.' }
        Write-Output "Uploaded https://$($policy.hostname)/$($html.name); SHA-256 $($html.sha256); original SCM restored."
    } finally {
        if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
        if ($lock) { $lock.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-Publisher }
