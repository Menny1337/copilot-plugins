param([Parameter(Mandatory)][string] $Scenario, [Parameter(Mandatory)][string] $WorkRoot)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\upload-html.ps1"
$realAzure = ${function:Invoke-Azure}

function Assert($condition, [string] $message) {
    if (-not $condition) { throw "Assertion failed: $message" }
}
function Expect-Error([scriptblock] $action, [string] $pattern) {
    $caught = $false
    try { & $action | Out-Null } catch {
        $caught = $true
        Assert ($_.Exception.Message -match $pattern) "Expected '$pattern', got '$($_.Exception.Message)'"
    }
    Assert $caught "Expected failure: $pattern"
}

$script:Config = Join-Path $WorkRoot 'config.json'
$script:SubscriptionId = '11111111-1111-4111-8111-111111111111'
$script:ResourceGroup = 'example-rg'
$script:AppName = 'example-host'
$tenant = '22222222-2222-4222-8222-222222222222'
$client = '33333333-3333-4333-8333-333333333333'
$group = '44444444-4444-4444-8444-444444444444'
$identity = '55555555-5555-4555-8555-555555555555'
$script:site = @{ defaultHostName = 'example-host.azurewebsites.net'; httpsOnly = $true; publicNetworkAccess = 'Enabled' }
$script:auth = @{
    platform = @{ enabled = $true }
    globalValidation = @{ requireAuthentication = $true; excludedPaths = @(); unauthenticatedClientAction = 'RedirectToLoginPage'; redirectToProvider = 'azureactivedirectory' }
    httpSettings = @{ requireHttps = $true; forwardProxy = @{ convention = 'NoProxy' } }
    login = @{ allowedExternalRedirectUrls = @(); tokenStore = @{ enabled = $true } }
    identityProviders = @{ azureActiveDirectory = @{
        enabled = $true
        registration = @{ clientId = $client; openIdIssuer = "https://login.microsoftonline.com/$tenant/v2.0"; clientSecretSettingName = 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID' }
        validation = @{ allowedAudiences = @($client) }
        login = @{ loginParameters = @('scope=openid profile offline_access https://graph.microsoft.com/User.Read') }
    } }
}
$deny = @{ ipAddress = 'Any'; action = 'Deny'; priority = 2147483647; name = 'Deny all'; description = 'Keep this exact description' }
$script:web = @{
    ipSecurityRestrictions = @(@{ ipAddress = 'CorpNetPublic'; tag = 'ServiceTag'; action = 'Allow'; priority = 100; name = 'Corporate' }, $deny)
    ipSecurityRestrictionsDefaultAction = 'Deny'
    scmIpSecurityRestrictions = @($deny)
    scmIpSecurityRestrictionsDefaultAction = 'Deny'
    scmIpSecurityRestrictionsUseMain = $false
}
$script:settings = @(
    @{ name = 'TENANT_ID'; value = $tenant }
    @{ name = 'ALLOWED_GROUP_IDS'; value = $group }
    @{ name = 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID'; value = $identity }
)
$script:basicAllowed = $false
$script:patches = 0
$script:deploys = 0
$script:reads = 0
$script:oldBytes = [Text.Encoding]::UTF8.GetBytes('<!doctype html><html>old</html>')
$script:newBytes = [Text.Encoding]::UTF8.GetBytes('<!doctype html><html><script>document.body.dataset.ok = "yes";</script>new</html>')
$script:remote = $null
$script:File = Join-Path $WorkRoot 'report.html'
[IO.File]::WriteAllBytes($script:File, $script:newBytes)
$script:initialScm = ConvertTo-Canonical (Get-Scm $script:web)

# These replacements are dot-source-only test seams, not environment switches in the uploader.
function Invoke-Azure([string[]] $Arguments) {
    if ($Arguments[0] -eq 'rest') {
        $uri = $Arguments[[array]::IndexOf($Arguments, '--url') + 1]
        Assert ($uri.StartsWith("https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$AppName")) 'ARM endpoint is pinned'
        $method = $Arguments[[array]::IndexOf($Arguments, '--method') + 1]
        if ($method -eq 'PATCH') {
            Assert ($uri -match '/config/web\?') 'Only web ingress may be changed'
            $bodyArg = $Arguments[[array]::IndexOf($Arguments, '--body') + 1]
            Assert ($bodyArg.StartsWith('@')) 'Use a JSON file rather than shell JSON quoting'
            $body = Get-Content -LiteralPath $bodyArg.Substring(1) -Raw | ConvertFrom-Json -AsHashtable
            Assert ($body.properties.Keys.Count -eq 3) 'Exactly SCM-only properties'
            Assert (@($body.properties.Keys | Where-Object { $_ -notlike 'scmIpSecurityRestrictions*' }).Count -eq 0) 'Do not mutate reader/auth/app settings'
            Assert (Test-Path -LiteralPath "$Config.recovery.json") 'Recovery is persisted before opening'
            $script:patches++
            if ($Scenario -eq 'restore-failure' -and $script:patches -eq 2) { throw 'Simulated restoration failure' }
            foreach ($key in $body.properties.Keys) { $script:web[$key] = $body.properties[$key] }
            if ($Scenario -eq 'open-failure' -and $script:patches -eq 1) { throw 'Simulated opening failure after server applied patch' }
            return @{ properties = $script:web }
        }
        Assert ($method -eq 'GET') 'No other ARM writes'
        if ($uri -match '/config/authsettingsV2\?') { return @{ properties = $script:auth } }
        if ($uri -match '/config/web\?') { return @{ properties = $script:web } }
        if ($uri -match '/basicPublishingCredentialsPolicies/scm\?') { return @{ properties = @{ allow = $script:basicAllowed } } }
        return @{ properties = $script:site }
    }
    if ($Arguments[0] -eq 'account') { return @{ token = 'FAKE-IN-MEMORY-TOKEN'; tenant = $tenant } }
    if ($Arguments[1] -eq 'config') { return $script:settings }
    Assert ($Arguments[1] -eq 'deploy') 'Only expected CLI operations'
    $script:deploys++
    Assert ($Arguments[[array]::IndexOf($Arguments, '--target-path') + 1] -ceq '/home/site/wwwroot/content/report.html') 'Only flat HTML destination'
    Assert ($Arguments[[array]::IndexOf($Arguments, '--clean') + 1] -eq 'false') 'Never clean site'
    Assert ($Arguments[[array]::IndexOf($Arguments, '--restart') + 1] -eq 'false') 'Never restart runtime'
    $src = $Arguments[[array]::IndexOf($Arguments, '--src-path') + 1]
    Assert ($src -ne $script:File) 'Deploy immutable local snapshot, not original file'
    if ($Scenario -eq 'deploy-failure') { throw 'Simulated deployment failure' }
    $script:remote = [IO.File]::ReadAllBytes($src)
    if ($Scenario -eq 'hash-mismatch') { $script:remote = $script:oldBytes }
    return @{ complete = $true; status = 4 }
}
function Invoke-KuduRead([string] $Name, [string] $Token) {
    Assert ($Token -eq 'FAKE-IN-MEMORY-TOKEN') 'Token stays in memory'
    Assert ($Name -eq 'report.html') 'Read only selected content'
    $script:reads++
    if ($Scenario -eq 'read-failure') { throw 'Simulated Kudu read failure' }
    if ($null -eq $script:remote) { return @{ exists = $false } }
    return @{ exists = $true; bytes = $script:remote }
}

if ($Scenario -eq 'azure-wrapper') {
    $script:Publisher = @{ subscriptionId = $SubscriptionId }
    $script:fakeCli = Join-Path $WorkRoot 'fake-az.ps1'
    [IO.File]::WriteAllText($script:fakeCli, '$global:LASTEXITCODE=0; @{arguments=@($args)} | ConvertTo-Json -Compress')
    function Get-Command { return @{ Source = $script:fakeCli } }
    $result = & $realAzure @('rest', '--method', 'GET', '--url', 'https://management.azure.com/')
    Assert ($result.arguments[-3] -eq '--subscription' -and $result.arguments[-2] -eq $SubscriptionId) 'Real wrapper scopes every CLI invocation'
    Assert ($result.arguments[-1] -eq '--only-show-errors') 'Real wrapper suppresses verbose CLI logs'
    $script:fakeCli = [IO.Path]::Combine($WorkRoot, 'wbin', 'az.cmd')
    Expect-Error { & $realAzure @('rest', '--method', 'GET') } 'no bundled python.exe'
} elseif ($Scenario -eq 'missing-config') {
    Expect-Error { Invoke-Publisher } 'Config missing.*-Init'
} elseif ($Scenario -eq 'validation') {
    Assert ((Read-Html $script:File).sha256 -eq [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($script:newBytes))) 'Trusted inline JS bytes unchanged'
    foreach ($case in @(
        @{ name = 'empty.html'; bytes = [byte[]]@() }
        @{ name = 'not.html'; bytes = [Text.Encoding]::UTF8.GetBytes('plain text') }
        @{ name = 'evil.HTML'; bytes = $script:newBytes }
        @{ name = 'two.dots.html'; bytes = $script:newBytes }
        @{ name = 'large.html'; bytes = [byte[]]::new(1MB + 1) }
        @{ name = 'invalid.html'; bytes = [byte[]]@(255, 254, 255) }
    )) {
        $path = Join-Path $WorkRoot $case.name
        [IO.File]::WriteAllBytes($path, $case.bytes)
        Expect-Error { Read-Html $path } '.+'
    }
    $embedded = Join-Path $WorkRoot 'embedded.html'
    [IO.File]::WriteAllText($embedded, '<html><img src="data:image/png;base64,AA=="><style>body{background:url(data:image/png;base64,AA==)}</style></html>')
    $null = Read-Html $embedded
    $normal = Join-Path $WorkRoot 'normal.html'
    $normalBytes = [Text.Encoding]::UTF8.GetPreamble() + [Text.Encoding]::UTF8.GetBytes('<html><script src="other.js"></script><style>body{background:url(other.png)}</style></html>')
    [IO.File]::WriteAllBytes($normal, $normalBytes)
    Assert ((Read-Html $normal).bytes.Length -eq $normalBytes.Length) 'Normal HTML dependencies and UTF-8 BOM remain unchanged'
    Assert ((Get-ScmHostname 'example-host.azurewebsites.net') -ceq 'example-host.scm.azurewebsites.net') 'Classic SCM hostname'
    Assert ((Get-ScmHostname 'example-host-abc123.westus.azurewebsites.net') -ceq 'example-host-abc123.scm.westus.azurewebsites.net') 'Unique regional SCM hostname'
    Expect-Error { Read-Html $WorkRoot } '.+'
    if ($IsWindows) {
        $linked = Join-Path $WorkRoot 'linked'
        $null = New-Item -ItemType Junction -Path $linked -Target $WorkRoot
        try { Expect-Error { Read-Html (Join-Path $linked 'report.html') } 'reparse-point' }
        finally { if (Test-Path -LiteralPath $linked) { Remove-Item -LiteralPath $linked } }
    }
} else {
    $script:Init = $true
    if ($Scenario -eq 'unsafe-host') { $script:site.defaultHostName = 'example-host.evil.test' }
    if ($Scenario -eq 'unsafe-auth') { $script:auth.globalValidation.excludedPaths = @('/public') }
    if ($Scenario -eq 'unsafe-readers') { $script:web.ipSecurityRestrictions[0].ipAddress = 'Any' }
    if ($Scenario -eq 'basic-auth') { $script:basicAllowed = $true }
    if ($Scenario -like 'unsafe-*' -or $Scenario -eq 'basic-auth') {
        Expect-Error { Invoke-Publisher } '.+'
        Assert (-not (Test-Path -LiteralPath $Config)) 'Unsafe config not created'
    } else {
        Invoke-Publisher | Out-Null
        Assert ($script:patches -eq 0 -and $script:deploys -eq 0) 'Init has no cloud writes'
        $saved = Get-Content -LiteralPath $Config -Raw
        Assert ($saved -notmatch 'FAKE-IN-MEMORY-TOKEN|accessToken|clientSecret') 'Config excludes credentials'
        if ($Scenario -eq 'init') {
            Expect-Error { Invoke-Publisher } 'already exists'
            Assert ((Get-Content -LiteralPath $Config -Raw) -ceq $saved) 'Init never overwrites'
        } else {
            $script:Init = $false
            switch ($Scenario) {
                'drift' { $script:settings[1].value = '66666666-6666-4666-8666-666666666666' }
                'auth-drift' { $script:auth.login.cookieExpiration = @{ convention = 'FixedTime'; timeToExpiration = '01:00:00' } }
                'overwrite-refusal' { $script:remote = $script:oldBytes }
                'overwrite' { $script:remote = $script:oldBytes; $script:Overwrite = $true }
                'deploy-failure' { $script:remote = $script:oldBytes; $script:Overwrite = $true }
            }
            if ($Scenario -eq 'lock') {
                $held = [IO.File]::Open("$Config.lock", 'OpenOrCreate', 'ReadWrite', 'None')
                try { Expect-Error { Invoke-Publisher } 'Another local uploader' } finally { $held.Dispose() }
            } elseif ($Scenario -eq 'recovery') {
                $script:Publisher = $saved | ConvertFrom-Json -AsHashtable
                $record = @{
                    version = 1; subscriptionId = $SubscriptionId; resourceGroup = $ResourceGroup; appName = $AppName
                    scm = $script:Publisher.expected.scm
                }
                Write-NewJson "$Config.recovery.json" $record
                $script:web.scmIpSecurityRestrictions = @(@{ ipAddress = 'CorpNetPublic'; action = 'Allow'; tag = 'ServiceTag' })
                Expect-Error { Invoke-Publisher } 'Unfinished upload'
                $script:Recover = $true
                Invoke-Publisher | Out-Null
                Assert ($script:patches -eq 1) 'Recovery closes SCM only'
            } elseif ($Scenario -eq 'restore-failure') {
                Expect-Error { Invoke-Publisher } 'restoration failure'
                Assert (Test-Path -LiteralPath "$Config.recovery.json") 'Failed restore preserves recovery'
                $script:Recover = $true
                Invoke-Publisher | Out-Null
                Assert (-not (Test-Path -LiteralPath "$Config.recovery.json")) 'Retry recovery verifies closed state'
            } else {
                $publisherOutput = @()
                $expectedError = @{
                    'drift' = 'drifted'; 'auth-drift' = 'drifted'; 'overwrite-refusal' = 'Destination exists'
                    'deploy-failure' = 'deployment failure'; 'hash-mismatch' = 'SHA-256'; 'read-failure' = 'read failure'
                    'open-failure' = 'opening failure'
                }
                if ($expectedError.ContainsKey($Scenario)) { Expect-Error { Invoke-Publisher } $expectedError[$Scenario] }
                else { $publisherOutput = @(Invoke-Publisher) }
                if ($Scenario -in @('drift', 'auth-drift')) {
                    Assert ($script:patches -eq 0 -and $script:deploys -eq 0) 'Drift refused without writes'
                } else {
                    Assert ($script:patches -eq 2) 'SCM restored on success and failure'
                    Assert (-not (Test-Path -LiteralPath "$Config.recovery.json")) 'Verified recovery record cleared'
                    if ($Scenario -eq 'overwrite-refusal') { Assert ($script:deploys -eq 0) 'Existing HTML untouched without overwrite' }
                    if ($Scenario -in @('overwrite', 'deploy-failure')) {
                        $backups = @(Get-ChildItem -LiteralPath (Join-Path $WorkRoot 'backups') -Filter 'report.html' -Recurse)
                        Assert ($backups.Count -eq 1) 'One rollback copy with original name'
                        Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($backups[0].FullName)) -ceq [Convert]::ToBase64String($script:oldBytes)) 'Exact previous bytes retained'
                    }
                    if ($Scenario -in @('upload', 'overwrite')) {
                        Assert ($script:reads -eq 2) 'Preflight plus verification read'
                        Assert ([Convert]::ToBase64String($script:remote) -ceq [Convert]::ToBase64String($script:newBytes)) 'Inline JavaScript preserved'
                        Assert (($publisherOutput -join "`n") -match 'Uploaded https://example-host\.azurewebsites\.net/report\.html; SHA-256 ') 'Success output returns the host public URL'
                    }
                }
            }
        }
    }
}
Assert ((ConvertTo-Canonical (Get-Scm $script:web)) -ceq $script:initialScm) 'Original SCM policy retained/restored exactly'
Assert (@(Get-ChildItem -LiteralPath $WorkRoot -Filter '.upload-*' -Force).Count -eq 0) 'Staging cleaned'
Assert (@(Get-ChildItem -LiteralPath $WorkRoot -Filter '*.body-*.json').Count -eq 0) 'Body files cleaned'
Write-Output "PASS $Scenario"
