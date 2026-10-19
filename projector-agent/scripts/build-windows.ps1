param([ValidateSet('win-x64', 'win-arm64')][string]$Runtime = 'win-x64', [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+$')][string]$Version = '0.1.0')
$ErrorActionPreference = 'Stop'
$ProjectorRoot = Split-Path $PSScriptRoot -Parent
$ProjectorOutput = Join-Path $ProjectorRoot "packages/$Runtime"
dotnet publish "$ProjectorRoot/src/Projector.Windows/Projector.Windows.csproj" -c Release -p:Version=$Version -r $Runtime --self-contained true -o "$ProjectorOutput/app"
if ($LASTEXITCODE -ne 0) { throw 'Windows helper publish failed' }
dotnet publish "$ProjectorRoot/src/Projector.Updater/Projector.Updater.csproj" -c Release -p:Version=$Version -r $Runtime --self-contained true -o "$ProjectorOutput/updater"
if ($LASTEXITCODE -ne 0) { throw 'Updater publish failed' }
dotnet publish "$ProjectorRoot/src/Projector.Launcher/Projector.Launcher.csproj" -c Release -p:Version=$Version -r $Runtime --self-contained true -o "$ProjectorOutput/launcher"
if ($LASTEXITCODE -ne 0) { throw 'Launcher publish failed' }
'UNSIGNED DEVELOPMENT BUILD - not an installer' | Set-Content "$ProjectorOutput/UNSIGNED.txt"
Compress-Archive -Path "$ProjectorOutput/app", "$ProjectorOutput/updater", "$ProjectorOutput/launcher", "$ProjectorOutput/UNSIGNED.txt" -DestinationPath "$ProjectorOutput/lecturer-projector-$Runtime-unsigned.zip" -Force
