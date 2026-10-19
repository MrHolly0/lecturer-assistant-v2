param(
    [ValidateSet('win-x64', 'win-arm64')][string]$Runtime = 'win-x64',
    [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+$')][string]$Version = '0.1.0',
    [switch]$SkipInstaller,
    [string]$InnoCompiler = ''
)
$ErrorActionPreference = 'Stop'
$ProjectorRoot = Split-Path $PSScriptRoot -Parent
$ProjectorOutput = Join-Path $ProjectorRoot "packages/$Runtime"
$BuildRoot = Join-Path $ProjectorOutput ('.build-' + [Guid]::NewGuid().ToString('N'))
$Platform = if ($Runtime -eq 'win-arm64') { 'WINDOWS_ARM64' } else { 'WINDOWS_X64' }
$PackageName = "lecturer-projector-$Runtime-$Version"
$TrustArguments = @()
if ($env:PROJECTOR_TRUST_FILE) {
    $TrustFile = (Resolve-Path -LiteralPath $env:PROJECTOR_TRUST_FILE).Path
    $TrustArguments = @("-p:ProjectorTrustFile=$TrustFile")
}
New-Item -ItemType Directory -Path $ProjectorOutput, $BuildRoot -Force | Out-Null

try {
    foreach ($ProjectorProject in @(
        @{ Name = 'Projector.Windows'; Directory = 'app' },
        @{ Name = 'Projector.Updater'; Directory = 'updater' },
        @{ Name = 'Projector.Launcher'; Directory = 'launcher' }
    )) {
        $PublishOutput = Join-Path $BuildRoot $ProjectorProject.Directory
        dotnet publish "$ProjectorRoot/src/$($ProjectorProject.Name)/$($ProjectorProject.Name).csproj" -c Release "-p:Version=$Version" @TrustArguments -r $Runtime --self-contained true -o $PublishOutput
        if ($LASTEXITCODE -ne 0) { throw "$($ProjectorProject.Name) publish failed" }
    }

    # The signed updater consumes this exact bounded ZIP, not the Inno installer.
    # Stable launcher is deliberately outside immutable version slots.
    $SeedRoot = Join-Path $BuildRoot 'seed'
    New-Item -ItemType Directory -Path $SeedRoot | Out-Null
    Move-Item (Join-Path $BuildRoot 'app'), (Join-Path $BuildRoot 'updater') -Destination $SeedRoot
    $UpdateZip = Join-Path $ProjectorOutput "$PackageName-update-unsigned.zip"
    if (Test-Path $UpdateZip) { Remove-Item $UpdateZip }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($SeedRoot, $UpdateZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    $PackageHash = (Get-FileHash $UpdateZip -Algorithm SHA256).Hash.ToLowerInvariant()
    $PackageSize = (Get-Item $UpdateZip).Length
    $Bootstrap = [ordered]@{
        version = $Version
        platform = $Platform
        entryPoint = 'app/Projector.Windows.exe'
        packageSha256 = $PackageHash
        packageSize = $PackageSize
        minimumOsVersion = '10.0.19045'
        protocolVersion = 1
    }
    $BootstrapFile = Join-Path $ProjectorOutput 'bootstrap.json'
    $Bootstrap | ConvertTo-Json | Set-Content -LiteralPath $BootstrapFile -Encoding utf8NoBOM
    $LauncherOutput = Join-Path $ProjectorOutput 'launcher'
    if (Test-Path $LauncherOutput) { Remove-Item $LauncherOutput -Recurse -Force }
    Move-Item (Join-Path $BuildRoot 'launcher') $LauncherOutput
    'UNSIGNED DEVELOPMENT BUILD. Windows signing and physical HDMI qualification are required before public distribution.' |
        Set-Content (Join-Path $ProjectorOutput 'UNSIGNED.txt') -Encoding utf8NoBOM

    $Installer = $null
    if (-not $SkipInstaller) {
        if (-not $IsWindows) { throw 'ISCC must run on Windows. Use -SkipInstaller only for cross-publish verification.' }
        if (-not $InnoCompiler) {
            $CompilerCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue
            if ($CompilerCommand) { $InnoCompiler = $CompilerCommand.Source }
            else { $InnoCompiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe' }
        }
        if (-not (Test-Path -LiteralPath $InnoCompiler)) { throw 'Inno Setup 6.3+ compiler was not found. Install it from https://jrsoftware.org/isdl.php or pass -InnoCompiler.' }
        & $InnoCompiler "/DPackageRoot=$ProjectorOutput" "/DAppVersion=$Version" "/DTargetRuntime=$Runtime" "/DSeedFile=$UpdateZip" "$ProjectorRoot/installers/windows/lecturer-projector.iss"
        if ($LASTEXITCODE -ne 0) { throw 'Windows installer compilation failed' }
        $Installer = Join-Path $ProjectorOutput "$PackageName-setup-unsigned.exe"
        if (-not (Test-Path -LiteralPath $Installer)) { throw 'ISCC did not produce the expected installer' }
    }
    [ordered]@{
        version = $Version
        platform = $Platform
        runtime = $Runtime
        update = @{ file = [IO.Path]::GetFileName($UpdateZip); sha256 = $PackageHash; size = $PackageSize; entryPoint = $Bootstrap.entryPoint }
        installer = if ($Installer) { @{ file = [IO.Path]::GetFileName($Installer); sha256 = (Get-FileHash $Installer -Algorithm SHA256).Hash.ToLowerInvariant(); size = (Get-Item $Installer).Length } } else { $null }
        signing = 'UNSIGNED_DEVELOPMENT_ONLY'
        physicalWindowsAndHdmiVerified = $false
    } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $ProjectorOutput 'package-manifest.json') -Encoding utf8NoBOM
    Write-Output "Prepared $Runtime $Version. Unsigned artifacts: $ProjectorOutput"
}
finally {
    if (Test-Path $BuildRoot) { Remove-Item $BuildRoot -Recurse -Force }
}
