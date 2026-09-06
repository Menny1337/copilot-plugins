param(
    [Parameter(Mandatory)]
    [ValidateSet("list", "current", "mark", "foreground", "restore", "inspect", "discard", "close")]
    [string] $Command,

    [ValidateSet("msedge", "chrome")]
    [string] $Browser = "msedge",

    [long] $Handle = 0,
    [uint32] $ProcessId = 0,
    [string] $Marker = "",
    [long] $PreviousHandle = 0,
    [uint32] $PreviousProcessId = 0
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BrowserWindowNative
{
    public delegate bool EnumWindowsProc(IntPtr handle, IntPtr data);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr handle);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr handle);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr handle);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr handle, int command);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr handle, System.Text.StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool SetProp(IntPtr handle, string name, IntPtr value);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr GetProp(IntPtr handle, string name);
}
'@ -ErrorAction SilentlyContinue

$browserProcess = if ($Browser -eq "chrome") { "chrome" } else { "msedge" }

function Get-WindowProcessId([IntPtr] $WindowHandle) {
    $id = [uint32] 0
    [void] [BrowserWindowNative]::GetWindowThreadProcessId($WindowHandle, [ref] $id)
    return $id
}

function Get-WindowTitle([IntPtr] $WindowHandle) {
    $text = [Text.StringBuilder]::new(1024)
    [void] [BrowserWindowNative]::GetWindowText($WindowHandle, $text, $text.Capacity)
    return $text.ToString()
}

function Test-Identity([IntPtr] $WindowHandle, [uint32] $ExpectedProcessId, [string] $ExpectedMarker = "") {
    if (-not [BrowserWindowNative]::IsWindow($WindowHandle)) {
        return @{ exists = $false; matches = $false; actualProcessId = 0 }
    }

    $actual = Get-WindowProcessId $WindowHandle
    $processMatches = $ExpectedProcessId -gt 0 -and $actual -eq $ExpectedProcessId
    $markerMatches = [string]::IsNullOrEmpty($ExpectedMarker) -or
        [BrowserWindowNative]::GetProp($WindowHandle, "MnmBrowserWindow:$ExpectedMarker") -ne [IntPtr]::Zero
    return @{
        exists = $true
        matches = $processMatches -and $markerMatches
        processMatches = $processMatches
        markerMatches = $markerMatches
        actualProcessId = $actual
    }
}

function Write-Json($Value) {
    Write-Output (ConvertTo-Json -InputObject $Value -Compress -Depth 5)
}

switch ($Command) {
    "list" {
        $windows = [Collections.Generic.List[object]]::new()
        [BrowserWindowNative]::EnumWindows({
            param($windowHandle, $data)

            if ([BrowserWindowNative]::IsWindowVisible($windowHandle)) {
                $id = Get-WindowProcessId $windowHandle
                $process = Get-Process -Id $id -ErrorAction SilentlyContinue
                if ($process -and $process.ProcessName -eq $browserProcess) {
                    $windows.Add(@{
                        id = $windowHandle.ToInt64().ToString()
                        processId = $id
                        title = Get-WindowTitle $windowHandle
                    })
                }
            }
            return $true
        }, [IntPtr]::Zero) | Out-Null
        Write-Json $windows.ToArray()
    }

    "current" {
        $windowHandle = [BrowserWindowNative]::GetForegroundWindow()
        $id = if ($windowHandle -eq [IntPtr]::Zero) { 0 } else { Get-WindowProcessId $windowHandle }
        Write-Json @{
            id = $windowHandle.ToInt64().ToString()
            processId = $id
        }
    }

    "mark" {
        if ([string]::IsNullOrEmpty($Marker)) {
            Write-Json @{ exists = $false; matches = $false; marked = $false }
            exit 2
        }
        $windowHandle = [IntPtr] $Handle
        $identity = Test-Identity $windowHandle $ProcessId
        $marked = $identity.matches -and
            [BrowserWindowNative]::SetProp($windowHandle, "MnmBrowserWindow:$Marker", [IntPtr] 1)
        Write-Json ($identity + @{ marked = $marked })
        if (-not $marked) { exit 2 }
    }

    "foreground" {
        $windowHandle = [IntPtr] $Handle
        $identity = Test-Identity $windowHandle $ProcessId $Marker
        if (-not $identity.matches) {
            Write-Json ($identity + @{ focused = $false })
            exit 2
        }

        [void] [BrowserWindowNative]::ShowWindowAsync($windowHandle, 5)
        [void] [BrowserWindowNative]::SetForegroundWindow($windowHandle)
        Start-Sleep -Milliseconds 250
        Write-Json ($identity + @{
            focused = [BrowserWindowNative]::GetForegroundWindow() -eq $windowHandle
        })
    }

    "restore" {
        $windowHandle = [IntPtr] $PreviousHandle
        $identity = Test-Identity $windowHandle $PreviousProcessId
        if ($identity.matches) {
            [void] [BrowserWindowNative]::ShowWindowAsync($windowHandle, 5)
            [void] [BrowserWindowNative]::SetForegroundWindow($windowHandle)
        }
        Write-Json ($identity + @{
            restored = $identity.matches -and
                [BrowserWindowNative]::GetForegroundWindow() -eq $windowHandle
        })
    }

    "inspect" {
        Write-Json (Test-Identity ([IntPtr] $Handle) $ProcessId $Marker)
    }

    "discard" {
        $windowHandle = [IntPtr] $Handle
        $identity = Test-Identity $windowHandle $ProcessId
        $titleMatches = -not [string]::IsNullOrEmpty($Marker) -and
            (Get-WindowTitle $windowHandle).Contains($Marker)
        if (-not $identity.matches -or -not $titleMatches) {
            Write-Json ($identity + @{ closed = $false; titleMatches = $titleMatches })
            exit 2
        }
        [void] [BrowserWindowNative]::PostMessage(
            $windowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero
        )
        for ($attempt = 0; $attempt -lt 50 -and [BrowserWindowNative]::IsWindow($windowHandle); $attempt++) {
            Start-Sleep -Milliseconds 100
        }
        Write-Json @{
            exists = [BrowserWindowNative]::IsWindow($windowHandle)
            matches = $true
            closed = -not [BrowserWindowNative]::IsWindow($windowHandle)
        }
    }

    "close" {
        $windowHandle = [IntPtr] $Handle
        $identity = Test-Identity $windowHandle $ProcessId $Marker
        if (-not $identity.exists) {
            Write-Json ($identity + @{ closed = $true; alreadyClosed = $true })
            break
        }
        if (-not $identity.matches) {
            Write-Json ($identity + @{ closed = $false; alreadyClosed = $false })
            exit 2
        }

        [void] [BrowserWindowNative]::PostMessage(
            $windowHandle,
            0x0010,
            [IntPtr]::Zero,
            [IntPtr]::Zero
        )
        for ($attempt = 0; $attempt -lt 50 -and [BrowserWindowNative]::IsWindow($windowHandle); $attempt++) {
            Start-Sleep -Milliseconds 100
        }

        Write-Json @{
            exists = [BrowserWindowNative]::IsWindow($windowHandle)
            matches = $true
            actualProcessId = $identity.actualProcessId
            closed = -not [BrowserWindowNative]::IsWindow($windowHandle)
            alreadyClosed = $false
        }
    }
}
