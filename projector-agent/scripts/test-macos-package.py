#!/usr/bin/env python3
"""Exercise a built seed and stable launcher only in a temporary installation, without native UI."""
from pathlib import Path
import fcntl, hashlib, json, os, platform, subprocess, sys, tempfile

bundle = Path(sys.argv[1]).resolve()
resources = bundle / 'Contents/Resources'
launcher = bundle / 'Contents/MacOS/launcher/Projector.Launcher'
metadata = json.loads((resources / 'bootstrap.json').read_text())
expected = 'MACOS_ARM64' if platform.machine() == 'arm64' else 'MACOS_X64'
assert metadata['platform'] == expected, 'Run on the same architecture as the package'
assert hashlib.sha256((resources / 'seed.zip').read_bytes()).hexdigest() == metadata['packageSha256']

def run(*args, expected_code=None):
    result = subprocess.run([str(launcher), *map(str, args)], text=True, capture_output=True, timeout=120)
    output = (result.stdout + result.stderr).strip()
    if expected_code:
        assert result.returncode != 0 and expected_code in output, (expected_code, result.returncode, output)
    else:
        assert result.returncode == 0, (result.returncode, output)
    return output

with tempfile.TemporaryDirectory(prefix='projector-package-') as fixture:
    data = Path(fixture) / 'data with spaces'
    data.mkdir()
    root = data / 'install'
    run('bootstrap-check', root, resources / 'bootstrap.json')
    assert not root.exists(), 'Read-only preflight created install files'
    installed = json.loads(run('bootstrap', root, resources / 'seed.zip', resources / 'bootstrap.json'))
    assert installed['state'] == 'INSTALLED'
    pointer = (root / 'current.json').read_bytes()
    current = json.loads(pointer)
    assert current['platform'] == expected and current['version'] == metadata['version']
    host = root / 'versions' / current['slot'] / 'Lecturer Projector Host.app'
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(host)], check=True)
    coordinator = host / 'Contents/MacOS/coordinator/Projector.Agent'
    result = subprocess.run([str(coordinator), '--self-test'], text=True, capture_output=True, timeout=20)
    assert result.returncode == 0 and 'no display' in result.stdout, result.stderr
    again = json.loads(run('bootstrap', root, resources / 'seed.zip', resources / 'bootstrap.json'))
    assert again['state'] == 'ALREADY_INSTALLED' and (root / 'current.json').read_bytes() == pointer
    # Native Swift uses flock. Prove the shared .NET guard respects the same lock.
    with (data / 'instance.lock').open('a+') as held:
        fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        run('bootstrap-check', root, resources / 'bootstrap.json', expected_code='HELPER_RUNNING')
        fcntl.flock(held.fileno(), fcntl.LOCK_UN)
    with (root / 'show.lock').open('a+') as held:
        fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        run('uninstall-check', root, expected_code='ACTIVE_SHOW')
        fcntl.flock(held.fileno(), fcntl.LOCK_UN)
    recovery = data / 'display-recovery.json'
    recovery.write_text('preserve recovery')
    run('uninstall-check', root, expected_code='DISPLAY_RECOVERY_REQUIRED')
    assert recovery.read_text() == 'preserve recovery'
    recovery.unlink()
    journal = root / 'update-transaction.json'
    journal.write_text('preserve update')
    run('bootstrap', root, resources / 'seed.zip', resources / 'bootstrap.json', expected_code='UPDATE_RECOVERY_REQUIRED')
    assert journal.read_text() == 'preserve update'
    journal.unlink()
    run('uninstall-check', root)
    assert (root / 'current.json').read_bytes() == pointer
print('PASS built self-contained package: first install, repeat, coordinator self-test, native flock interop, active-show/recovery guards; temporary files only, no native UI or OS configuration changes')
