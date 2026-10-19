#!/bin/sh
set -eu
projector_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
projector_arch=${1:-arm64}
projector_version=${2:-0.1.0}
case "$projector_version" in *[!0-9.]*|''|.*|*..*) echo 'Use numeric major.minor.patch version' >&2; exit 2 ;; esac
case "$projector_arch" in arm64) projector_rid=osx-arm64 ;; x86_64) projector_rid=osx-x64 ;; *) echo 'Use arm64 or x86_64' >&2; exit 2 ;; esac
projector_output="$projector_root/packages/$projector_rid"
projector_bundle="$projector_output/Lecturer Projector.app"
mkdir -p "$projector_bundle/Contents/MacOS/coordinator" "$projector_bundle/Contents/MacOS/updater" "$projector_bundle/Contents/MacOS/launcher"
swift build --package-path "$projector_root/macos" -c release --arch "$projector_arch"
projector_swift_bin=$(swift build --package-path "$projector_root/macos" -c release --arch "$projector_arch" --show-bin-path)
if [ "$(uname -m)" = "$projector_arch" ]; then
    "$projector_swift_bin/ProjectorMac" --journal-self-test
fi
cp "$projector_swift_bin/ProjectorMac" "$projector_bundle/Contents/MacOS/ProjectorMac"
dotnet publish "$projector_root/src/Projector.Agent/Projector.Agent.csproj" -c Release -p:Version="$projector_version" -r "$projector_rid" --self-contained true -o "$projector_bundle/Contents/MacOS/coordinator"
dotnet publish "$projector_root/src/Projector.Updater/Projector.Updater.csproj" -c Release -p:Version="$projector_version" -r "$projector_rid" --self-contained true -o "$projector_bundle/Contents/MacOS/updater"
cat > "$projector_bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ru.university.lecturer-projector</string>
<key>CFBundleName</key><string>Lecturer Projector</string>
<key>CFBundleExecutable</key><string>ProjectorMac</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
dotnet publish "$projector_root/src/Projector.Launcher/Projector.Launcher.csproj" -c Release -p:Version="$projector_version" -r "$projector_rid" --self-contained true -o "$projector_bundle/Contents/MacOS/launcher"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $projector_version" "$projector_bundle/Contents/Info.plist"
# Development artifact only. No ad-hoc signature is represented as Developer ID/notarization.
printf '%s\n' 'UNSIGNED DEVELOPMENT BUILD — do not advertise as installer' > "$projector_output/UNSIGNED.txt"
ditto -c -k --keepParent "$projector_bundle" "$projector_output/lecturer-projector-$projector_rid-unsigned.zip"
