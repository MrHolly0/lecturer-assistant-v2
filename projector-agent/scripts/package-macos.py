#!/usr/bin/env python3
"""Create regular-file update payloads and a signed, immutable Mac bootstrap bundle."""
import hashlib
import base64
import json
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys
import zipfile

MACHOS = {b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"}


def digest(path):
    with Path(path).open("rb") as stream:
        value = hashlib.sha256()
        while chunk := stream.read(1 << 20):
            value.update(chunk)
        return value.hexdigest()


def package_seed(bundle, output, metadata, version, platform):
    bundle, output, metadata = Path(bundle), Path(output), Path(metadata)
    if bundle.name != "Lecturer Projector Host.app":
        raise ValueError("Unexpected host bundle name")
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for item in sorted(bundle.rglob("*")):
            mode = item.lstat().st_mode
            if stat.S_ISDIR(mode):
                continue
            if not stat.S_ISREG(mode):
                raise ValueError("Update payload must contain regular files only: " + str(item))
            name = item.relative_to(bundle.parent).as_posix()
            entry = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = ((stat.S_IFREG | (0o755 if mode & 0o111 else 0o644)) << 16)
            entry.compress_type = zipfile.ZIP_DEFLATED
            with item.open("rb") as source, archive.open(entry, "w") as target:
                while data := source.read(1 << 20):
                    target.write(data)
    value = dict(version=version, platform=platform,
                 entryPoint="Lecturer Projector Host.app/Contents/MacOS/ProjectorMac",
                 packageSha256=digest(output), packageSize=output.stat().st_size,
                 minimumOsVersion="14.0", protocolVersion=1)
    metadata.write_text(json.dumps(value, indent=2) + "\n")


def write_plist(bundle, version, role, mode):
    host = role == "host"
    value = dict(CFBundleIdentifier="ru.university.lecturer-projector.host" if host else "ru.university.lecturer-projector",
                 CFBundleName="Lecturer Projector Host" if host else "Lecturer Projector",
                 CFBundleDisplayName="Lecturer Projector", CFBundleExecutable="ProjectorMac" if host else "ProjectorBootstrap",
                 CFBundlePackageType="APPL", CFBundleShortVersionString=version, CFBundleVersion=version,
                 LSUIElement=True, LSMinimumSystemVersion="14.0", NSHighResolutionCapable=True,
                 LAReleaseMode=mode)
    if not host:
        value["CFBundleURLTypes"] = [dict(CFBundleURLName="Lecturer Projector pairing", CFBundleURLSchemes=["lecturer-projector"], CFBundleTypeRole="Viewer")]
    else:
        value["NSScreenCaptureUsageDescription"] = "Передача выбранного учебного окна или экрана студентам. Пульт и окно проектора исключаются из захвата."
    with (Path(bundle) / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump(value, stream, sort_keys=True)


def sign(bundle, identity, entitlements, development=False):
    if not (development and identity == "-") and not identity.startswith("Developer ID Application:"):
        raise ValueError("A Developer ID Application identity is required")
    bundle = Path(bundle)
    for item in sorted(bundle.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        if not item.is_file():
            continue
        with item.open("rb") as stream:
            if stream.read(4) not in MACHOS:
                continue
        command = ["codesign", "--force", "--options", "runtime", "--sign", identity]
        if not development:
            command += ["--timestamp"]
        if any(part in ("coordinator", "updater", "launcher") for part in item.parts):
            command += ["--entitlements", entitlements]
        subprocess.run(command + [str(item)], check=True)
    command = ["codesign", "--force", "--options", "runtime", "--sign", identity]
    if not development:
        command += ["--timestamp"]
    subprocess.run(command + [str(bundle)], check=True)


def sign_development(bundle, entitlements):
    sign(bundle, "-", entitlements, development=True)


def check_native(bundle):
    count = 0
    for item in Path(bundle).rglob("*"):
        if not item.is_file():
            continue
        with item.open("rb") as stream:
            if stream.read(4) not in MACHOS:
                continue
        output = subprocess.check_output(["otool", "-L", str(item)], text=True)
        for line in output.splitlines()[1:]:
            dependency = line.strip().split(" (", 1)[0]
            if not dependency.startswith(("/System/Library/", "/usr/lib/", "@rpath/", "@loader_path/", "@executable_path/")):
                raise ValueError("Nonportable native dependency: " + dependency + " in " + str(item))
        count += 1
    if count == 0:
        raise ValueError("No native executables found in bundle")
    print("PASS native dependencies use only system or bundle-relative libraries: " + str(count) + " Mach-O files")


def trust(path):
    data = json.loads(Path(path).read_text())
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", data.get("repository", "")) or not data.get("keys"):
        raise ValueError("Production release trust must name a repository and public keys")
    for key, value in data["keys"].items():
        if not key or not isinstance(value, str) or "PRIVATE" in value:
            raise ValueError("Invalid public release trust")
        key_bytes = base64.b64decode(value, validate=True)
        spki_header = bytes.fromhex("3059301306072a8648ce3d020106082a8648ce3d03010703420004")
        if len(key_bytes) != 91 or not key_bytes.startswith(spki_header):
            raise ValueError("Release trust requires P-256 SPKI public keys")


def report(bundle, image, update, mode):
    image, update = Path(image), Path(update)
    value = dict(mode=mode, developerIdNotarized=mode == "production",
                 installer=dict(file=image.name, sha256=digest(image), size=image.stat().st_size),
                 update=dict(file=update.name, sha256=digest(update), size=update.stat().st_size),
                 bootstrap=json.loads((Path(bundle) / "Contents/Resources/bootstrap.json").read_text()),
                 installedDuringBuild=False, loginItemsChanged=False, keychainChanged=False,
                 displayConfigurationChanged=False, hardwareTested=False)
    image.with_suffix(".json").write_text(json.dumps(value, indent=2) + "\n")


if __name__ == "__main__":
    commands = {"seed": package_seed, "plist": write_plist, "sign": sign, "sign-development": sign_development, "check-native": check_native, "trust": trust, "report": report}
    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        raise SystemExit("Use seed, plist, sign, trust or report")
    commands[sys.argv[1]](*sys.argv[2:])
