#!/usr/bin/env python3
"""Exercise Mac bundle packaging using temporary files; never install or launch an app."""
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import stat
import tempfile
import zipfile

script = Path(__file__).resolve().parents[2] / "scripts/package-macos.py"
spec = importlib.util.spec_from_file_location("projector_mac_package", script)
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

with tempfile.TemporaryDirectory(prefix="projector-package-check-") as directory:
    root = Path(directory)
    host = root / "Lecturer Projector Host.app"
    executable = host / "Contents/MacOS/ProjectorMac"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"fixture-host-not-executed")
    executable.chmod(0o755)
    package.write_plist(host, "0.1.0", "host", "development")
    payload = root / "seed.zip"
    metadata = root / "bootstrap.json"
    package.package_seed(host, payload, metadata, "0.1.0", "MACOS_ARM64")
    value = json.loads(metadata.read_text())
    assert value["packageSha256"] == hashlib.sha256(payload.read_bytes()).hexdigest()
    assert value["packageSize"] == payload.stat().st_size
    with zipfile.ZipFile(payload) as archive:
        assert not any(name.startswith("__MACOSX/") or name.endswith("/") for name in archive.namelist())
        entry = archive.getinfo(value["entryPoint"])
        assert stat.S_ISREG(entry.external_attr >> 16)
        assert (entry.external_attr >> 16) & 0o111
        assert archive.read(value["entryPoint"]) == executable.read_bytes()
        info = plistlib.loads(archive.read("Lecturer Projector Host.app/Contents/Info.plist"))
        assert info["CFBundleIdentifier"] == "ru.university.lecturer-projector.host"
        assert info["LSMinimumSystemVersion"] == "14.0"
    link = host / "Contents/unsafe-link"
    link.symlink_to(executable)
    try:
        package.package_seed(host, payload, metadata, "0.1.0", "MACOS_ARM64")
        raise AssertionError("Symlink payload was accepted")
    except ValueError:
        pass
    trust = root / "trust.json"
    trust.write_text('{"repository":"owner/project","keys":{}}')
    try:
        package.trust(trust)
        raise AssertionError("Empty production trust was accepted")
    except ValueError:
        pass
print("PASS Mac seed hash/size, regular-file ZIP, executable mode, distinct host identity, symlink rejection and missing production trust; temporary fixtures only")
