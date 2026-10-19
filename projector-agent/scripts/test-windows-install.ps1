param(
    [Parameter(Mandatory)][string]$Installer,
    [string]$Version = '0.1.0',
    [ValidateSet('WINDOWS_X64', 'WINDOWS_ARM64')][string]$Platform = 'WINDOWS_X64',
    [string]$UpgradeInstaller = '',
    [string]$UpgradeVersion = '0.1.1'
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Installer smoke requires an isolated Windows runner' }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$TemporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$TestRoot = Join-Path $TemporaryRoot ('lecturer-projector-install-' + [Guid]::NewGuid().ToString('N'))
$InstallRoot = Join-Path $TestRoot 'installed'
$StartupName = 'LecturerAssistantProjector'
function Get-ProjectorStartupValue {
    $RunKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
    if ($null -eq $RunKey) { return $null }
    try { return $RunKey.GetValue($StartupName, $null) }
    finally { $RunKey.Dispose() }
}
if ($env:GITHUB_ENV) { "PROJECTOR_INSTALL_SMOKE_ROOT=$TestRoot" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append }
$InitialStartup = Get-ProjectorStartupValue
$InitialHosts = @(Get-Process Projector.Windows -ErrorAction SilentlyContinue).Id
if ($InitialHosts) { throw 'Native helper is running; use an isolated runner' }
if ($InitialStartup) { throw 'A projector autostart entry exists; use an isolated runner' }
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null

function Run-Installer([string]$Executable, [string[]]$Arguments) {
    $Run = Start-Process -FilePath $Executable -ArgumentList $Arguments -Wait -PassThru
    if ($Run.ExitCode -ne 0) { throw "Installer command failed with exit code $($Run.ExitCode)" }
}
function Test-InstalledHost($Slot, [string]$ExpectedVersion, [string]$ReportName) {
    $ReportPath = Join-Path $TestRoot $ReportName
    $Executable = Join-Path (Join-Path (Join-Path $InstallRoot 'versions') $Slot.slot) $Slot.entryPoint
    $Diagnostic = Start-Process -FilePath $Executable -ArgumentList @('--preflight', "`"$ReportPath`"") -Wait -PassThru
    if ($Diagnostic.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $ReportPath)) { throw 'Installed native host preflight did not run successfully' }
    $Report = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json
    $ExpectedArchitecture = $Platform.Replace('WINDOWS_', '')
    if ($Report.mode -ne 'PREFLIGHT' -or $Report.version -ne $ExpectedVersion -or $Report.platform -ne $Platform -or $Report.processArchitecture -ne $ExpectedArchitecture -or $Report.osArchitecture -ne $ExpectedArchitecture) { throw 'Native host reported the wrong version or architecture' }
    foreach ($Flag in @('displayMutation', 'startupChanged', 'uiOpened', 'networkRequested', 'pairingChanged')) {
        if ($null -eq $Report.$Flag -or $Report.$Flag -ne $false) { throw "Preflight mutation flag is missing or unsafe: $Flag" }
    }
    if ($Report.webView2.status -notin @('AVAILABLE', 'MISSING_OR_UNAVAILABLE')) { throw 'WebView2 diagnosis was not explicit' }
    if (Get-Process Projector.Windows -ErrorAction SilentlyContinue) { throw 'Preflight left a native host process running' }
}
try {
    Run-Installer $Installer @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/TASKS=""', "/DIR=`"$InstallRoot`"", "/LOG=`"$(Join-Path $TestRoot 'install.log')`"")
    $Pointer = Get-Content -LiteralPath (Join-Path $InstallRoot 'current.json') -Raw | ConvertFrom-Json
    if ($Pointer.version -ne $Version -or $Pointer.platform -ne $Platform -or $Pointer.entryPoint -ne 'app/Projector.Windows.exe') { throw 'Wrong initial installed slot' }
    $SlotRoot = Join-Path (Join-Path $InstallRoot 'versions') $Pointer.slot
    foreach ($Required in @('app/Projector.Windows.exe', 'updater/Projector.Updater.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $SlotRoot $Required))) { throw "Missing installed file: $Required" }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'launcher/Projector.Launcher.exe'))) { throw 'Stable launcher missing' }
    if (Get-Process Projector.Windows -ErrorAction SilentlyContinue) { throw 'Silent installation launched native UI' }
    if (Get-ProjectorStartupValue) { throw 'Silent installation enabled autostart without opt-in' }
    Test-InstalledHost $Pointer $Version 'host-preflight.json'

    # Idempotent reinstallation must keep the same verified immutable slot.
    Run-Installer $Installer @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/TASKS=""', "/DIR=`"$InstallRoot`"", "/LOG=`"$(Join-Path $TestRoot 'reinstall.log')`"")
    $Again = Get-Content -LiteralPath (Join-Path $InstallRoot 'current.json') -Raw | ConvertFrom-Json
    if ($Again.slot -ne $Pointer.slot -or $Again.packageSha256 -ne $Pointer.packageSha256) { throw 'Reinstallation changed the verified active slot' }

    if ($UpgradeInstaller) {
        $UpgradeInstaller = (Resolve-Path -LiteralPath $UpgradeInstaller).Path
        Run-Installer $UpgradeInstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/TASKS=""', "/DIR=`"$InstallRoot`"", "/LOG=`"$(Join-Path $TestRoot 'upgrade.log')`"")
        $Upgraded = Get-Content -LiteralPath (Join-Path $InstallRoot 'current.json') -Raw | ConvertFrom-Json
        if ($Upgraded.version -ne $UpgradeVersion -or $Upgraded.platform -ne $Platform -or $Upgraded.slot -eq $Pointer.slot) { throw 'Manual installer upgrade did not activate a new verified slot' }
        Test-InstalledHost $Upgraded $UpgradeVersion 'host-upgrade-preflight.json'
        $LauncherHash = (Get-FileHash (Join-Path $InstallRoot 'launcher/Projector.Launcher.exe') -Algorithm SHA256).Hash
        $Downgrade = Start-Process -FilePath $Installer -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/TASKS=""', "/DIR=`"$InstallRoot`"", "/LOG=`"$(Join-Path $TestRoot 'downgrade-refusal.log')`"") -Wait -PassThru
        $AfterDowngrade = Get-Content -LiteralPath (Join-Path $InstallRoot 'current.json') -Raw | ConvertFrom-Json
        if ($Downgrade.ExitCode -eq 0 -or $AfterDowngrade.slot -ne $Upgraded.slot -or (Get-FileHash (Join-Path $InstallRoot 'launcher/Projector.Launcher.exe') -Algorithm SHA256).Hash -ne $LauncherHash) { throw 'Old installer downgraded or changed the active product' }
    }

    # A live show.lock must reject removal without killing the host or dropping state.
    $ShowLock = [IO.File]::Open((Join-Path $InstallRoot 'show.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $Blocked = Start-Process -FilePath (Join-Path $InstallRoot 'uninstall/unins000.exe') -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -Wait -PassThru
        if ($Blocked.ExitCode -eq 0 -or -not (Test-Path (Join-Path $InstallRoot 'current.json'))) { throw 'Uninstall ignored active show lock' }
    }
    finally { $ShowLock.Dispose() }

    Run-Installer (Join-Path $InstallRoot 'uninstall/unins000.exe') @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$(Join-Path $TestRoot 'uninstall.log')`"")
    foreach ($Removed in @('current.json', 'versions', 'launcher/Projector.Launcher.exe')) {
        if (Test-Path -LiteralPath (Join-Path $InstallRoot $Removed)) { throw "Uninstaller left installed product files: $Removed" }
    }
    if (Get-Process Projector.Windows -ErrorAction SilentlyContinue) { throw 'Installer smoke launched a native helper process' }
    if (Get-ProjectorStartupValue) { throw 'Unexpected autostart mutation' }
    Write-Output 'PASS: per-user install, native host runtime preflight, immutable slot, idempotent reinstall, optional version upgrade/downgrade refusal, locked-show refusal, silent uninstall; no UI, display or autostart mutation'
}
finally {
    # Logs survive CI failure. No forced process stop, display change, pairing or credential deletion.
    Write-Output "Installer smoke logs: $TestRoot"
}
