#!/bin/sh
set -eu
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false DOTNET_NOLOGO=1
projector_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
projector_arch=${1:-arm64}
projector_version=${2:-0.1.0}
projector_mode=${3:-development}
case "$projector_version" in *[!0-9.]*|''|.*|*..*) echo 'Use numeric major.minor.patch version' >&2; exit 2 ;; esac
case "$projector_arch" in arm64) projector_rid=osx-arm64; projector_platform=MACOS_ARM64 ;; x86_64) projector_rid=osx-x64; projector_platform=MACOS_X64 ;; *) echo 'Use arm64 or x86_64' >&2; exit 2 ;; esac
case "$projector_mode" in development|production) ;; *) echo 'Use development or production mode' >&2; exit 2 ;; esac
if [ "$projector_mode" = production ]; then
    : "${PROJECTOR_MAC_SIGN_IDENTITY:?Developer ID Application signing identity is required}"
    : "${PROJECTOR_MAC_NOTARY_PROFILE:?Existing notarytool keychain profile is required}"
    : "${PROJECTOR_TRUST_FILE:?Public release trust file is required}"
    python3 "$projector_root/scripts/package-macos.py" trust "$PROJECTOR_TRUST_FILE"
fi
projector_output="$projector_root/packages/$projector_rid"
projector_work="$projector_output/build-$projector_mode"
projector_host="$projector_work/host/Lecturer Projector Host.app"
projector_bundle="$projector_work/disk/Lecturer Projector.app"
# Never reuse a package-manager SDK's locally patched runtime/host packs: they can
# carry absolute dependencies on that build machine. Restore official NuGet packs.
projector_framework_packs="$projector_output/official-framework-packs"
if [ -d "$projector_work" ]; then rm -rf "$projector_work"; fi
mkdir -p "$projector_host/Contents/MacOS/coordinator" "$projector_host/Contents/MacOS/updater" "$projector_bundle/Contents/MacOS/launcher" "$projector_bundle/Contents/Resources"
swift build --package-path "$projector_root/macos" -c release --arch "$projector_arch" --disable-sandbox
projector_swift_bin=$(swift build --package-path "$projector_root/macos" -c release --arch "$projector_arch" --show-bin-path)
if [ "$(uname -m)" = "$projector_arch" ]; then
    "$projector_swift_bin/ProjectorMac" --journal-self-test
    "$projector_swift_bin/ProjectorMac" --capture-self-test
    "$projector_swift_bin/ProjectorBootstrap" --self-test
fi
cp "$projector_swift_bin/ProjectorMac" "$projector_host/Contents/MacOS/ProjectorMac"
cp "$projector_swift_bin/ProjectorBootstrap" "$projector_bundle/Contents/MacOS/ProjectorBootstrap"
projector_publish() {
    if [ -n "${PROJECTOR_TRUST_FILE:-}" ]; then
        dotnet publish "$1" -c Release -p:Version="$projector_version" -p:ProjectorTrustFile="$PROJECTOR_TRUST_FILE" -p:NetCoreTargetingPackRoot="$projector_framework_packs" -p:AllowMissingPrunePackageData=true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=false -p:DebugSymbols=false -p:DebugType=None -r "$projector_rid" --self-contained true -o "$2"
    else
        dotnet publish "$1" -c Release -p:Version="$projector_version" -p:NetCoreTargetingPackRoot="$projector_framework_packs" -p:AllowMissingPrunePackageData=true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=false -p:DebugSymbols=false -p:DebugType=None -r "$projector_rid" --self-contained true -o "$2"
    fi
}
projector_publish "$projector_root/src/Projector.Agent/Projector.Agent.csproj" "$projector_host/Contents/MacOS/coordinator"
projector_publish "$projector_root/src/Projector.Updater/Projector.Updater.csproj" "$projector_host/Contents/MacOS/updater"
projector_publish "$projector_root/src/Projector.Launcher/Projector.Launcher.csproj" "$projector_bundle/Contents/MacOS/launcher"
python3 "$projector_root/scripts/package-macos.py" check-native "$projector_host"
python3 "$projector_root/scripts/package-macos.py" check-native "$projector_bundle"
python3 "$projector_root/scripts/package-macos.py" plist "$projector_host" "$projector_version" host "$projector_mode"
python3 "$projector_root/scripts/package-macos.py" plist "$projector_bundle" "$projector_version" bootstrap "$projector_mode"
if [ "$projector_mode" = production ]; then
    python3 "$projector_root/scripts/package-macos.py" sign "$projector_host" "$PROJECTOR_MAC_SIGN_IDENTITY" "$projector_root/macos/packaging/dotnet.entitlements"
    ditto -c -k --keepParent "$projector_host" "$projector_work/host-notarization.zip"
    xcrun notarytool submit "$projector_work/host-notarization.zip" --keychain-profile "$PROJECTOR_MAC_NOTARY_PROFILE" --wait
    xcrun stapler staple "$projector_host"
    xcrun stapler validate "$projector_host"
    codesign --verify --deep --strict "$projector_host"
    spctl --assess --type execute "$projector_host"
else
    python3 "$projector_root/scripts/package-macos.py" sign-development "$projector_host" "$projector_root/macos/packaging/dotnet.entitlements"
    codesign --verify --deep --strict "$projector_host"
fi
projector_update="$projector_output/lecturer-projector-$projector_rid-$projector_version-$projector_mode-update.zip"
python3 "$projector_root/scripts/package-macos.py" seed "$projector_host" "$projector_update" "$projector_bundle/Contents/Resources/bootstrap.json" "$projector_version" "$projector_platform"
cp "$projector_update" "$projector_bundle/Contents/Resources/seed.zip"
cp "$projector_root/macos/packaging/README.ru.txt" "$projector_work/disk/Прочитайте перед установкой.txt"
if [ "$projector_mode" = development ]; then
    printf '%s\n' 'DEVELOPMENT BUILD: no Developer ID/notarization; not a public release. Do not disable Gatekeeper.' > "$projector_work/disk/DEVELOPMENT.txt"
    # Ad-hoc seal is needed on Apple Silicon; it is never represented as Developer ID.
    python3 "$projector_root/scripts/package-macos.py" sign-development "$projector_bundle" "$projector_root/macos/packaging/dotnet.entitlements"
    codesign --verify --deep --strict "$projector_bundle"
else
    python3 "$projector_root/scripts/package-macos.py" sign "$projector_bundle" "$PROJECTOR_MAC_SIGN_IDENTITY" "$projector_root/macos/packaging/dotnet.entitlements"
    ditto -c -k --keepParent "$projector_bundle" "$projector_work/bootstrap-notarization.zip"
    xcrun notarytool submit "$projector_work/bootstrap-notarization.zip" --keychain-profile "$PROJECTOR_MAC_NOTARY_PROFILE" --wait
    xcrun stapler staple "$projector_bundle"
    xcrun stapler validate "$projector_bundle"
    codesign --verify --deep --strict "$projector_bundle"
    spctl --assess --type execute "$projector_bundle"
fi
projector_image="$projector_output/lecturer-projector-$projector_rid-$projector_version-$projector_mode.dmg"
if [ -f "$projector_image" ]; then rm "$projector_image"; fi
hdiutil create -volname 'Lecturer Projector' -srcfolder "$projector_work/disk" -format UDZO -ov "$projector_image"
hdiutil verify "$projector_image"
if [ "$projector_mode" = production ]; then
    codesign --sign "$PROJECTOR_MAC_SIGN_IDENTITY" --timestamp "$projector_image"
    xcrun notarytool submit "$projector_image" --keychain-profile "$PROJECTOR_MAC_NOTARY_PROFILE" --wait
    xcrun stapler staple "$projector_image"
    xcrun stapler validate "$projector_image"
    spctl --assess --type open --context context:primary-signature "$projector_image"
fi
python3 "$projector_root/scripts/package-macos.py" report "$projector_bundle" "$projector_image" "$projector_update" "$projector_mode"
printf '%s\n' "$projector_image"
