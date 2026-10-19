"""Exercise only newly spawned coordinator fixtures: stdin EOF and loss of its own mock parent."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import tempfile
import threading
import time


def fixture_env():
    return {k: v for k, v in os.environ.items() if not k.startswith('LA_PROJECTOR_')}


def line(stream, timeout=5):
    result = queue.Queue()
    threading.Thread(target=lambda: result.put(stream.readline()), daemon=True).start()
    return result.get(timeout=timeout)


def start(coordinator, stderr):
    child = subprocess.Popen(['dotnet', str(coordinator), '--native-stdio'], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=stderr, text=True, env=fixture_env())
    child.stdin.write(json.dumps({'origin': 'https://fixture.invalid/', 'name': 'Owned lifetime fixture',
                                 'platform': 'MACOS_ARM64', 'deviceToken': 'a' * 64}) + '\n')
    child.stdin.flush()
    first = json.loads(line(child.stdout))
    assert first['type'] == 'GET_SCREENS'
    return child


def process_identity(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'stat='], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def is_live(pid, identity):
    current = process_identity(pid)
    if not current:
        return False
    # lstart is stable, and a zombie has stopped executing even before reaping.
    assert current.rsplit(None, 1)[0] == identity.rsplit(None, 1)[0], 'Fixture PID identity changed'
    return not current.rsplit(None, 1)[1].startswith('Z')


def own_parent(coordinator, directory):
    with (directory / 'coordinator-error.log').open('w') as error:
        child = start(coordinator, error)
        print(json.dumps({'pid': child.pid}), flush=True)
        while True:
            time.sleep(60)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--coordinator', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--owned-parent', type=Path)
    opts = parser.parse_args()
    coordinator = opts.coordinator.resolve(strict=True)
    assert coordinator.name == 'Projector.Agent.dll'
    if opts.owned_parent:
        own_parent(coordinator, opts.owned_parent)
        return
    assert os.name == 'posix', 'Parent-death fixture runs on the isolated POSIX policy runner'
    assert opts.report and opts.report.is_absolute() and not opts.report.exists()
    if sys.platform.startswith('linux'):
        # This fixture process alone adopts/reaps its own orphaned grandchild.
        assert ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0
    report = {'success': False, 'stdinEofEndsCoordinator': False, 'parentDeathEndsCoordinator': False,
              'onlyOwnedFixtureProcesses': True, 'fixtureProcessesCleaned': False,
              'displayMutation': False, 'productionNetworkRequested': False, 'userInstallationChanged': False}
    try:
        with tempfile.TemporaryDirectory(prefix='projector-lifetime-') as temporary:
            folder = Path(temporary)
            with (folder / 'direct-error.log').open('w') as error:
                child = start(coordinator, error)
                try:
                    started = time.monotonic()
                    child.stdin.close()
                    assert child.wait(timeout=2) == 1
                    report['stdinEofSeconds'] = time.monotonic() - started
                    assert 'NATIVE_HOST_CLOSED' in (folder / 'direct-error.log').read_text()
                    assert not child.stdout.read(), 'Coordinator retried after EOF'
                    report['stdinEofEndsCoordinator'] = True
                finally:
                    if child.poll() is None:
                        child.kill(); child.wait(timeout=2)
                    child.stdout.close()
            parent = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--coordinator', str(coordinator),
                                       '--owned-parent', str(folder)], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True, env=fixture_env())
            pid = None
            identity = None
            try:
                pid = json.loads(line(parent.stdout))['pid']
                identity = process_identity(pid)
                assert identity
                started = time.monotonic()
                parent.kill(); parent.wait(timeout=2)
                while is_live(pid, identity) and time.monotonic() - started < 2:
                    time.sleep(0.02)
                assert not is_live(pid, identity), 'Coordinator remained alive after its mock parent was killed'
                if sys.platform.startswith('linux'):
                    _, status = os.waitpid(pid, 0)
                    assert os.waitstatus_to_exitcode(status) == 1
                report['parentDeathSeconds'] = time.monotonic() - started
                assert 'NATIVE_HOST_CLOSED' in (folder / 'coordinator-error.log').read_text()
                report['parentDeathEndsCoordinator'] = True
            finally:
                if parent.poll() is None:
                    parent.kill(); parent.wait(timeout=2)
                if pid and identity and is_live(pid, identity):
                    os.kill(pid, signal.SIGKILL)
                if pid and sys.platform.startswith('linux'):
                    try: os.waitpid(pid, 0)
                    except ChildProcessError: pass
                parent.stdout.close(); parent.stderr.close()
        report['fixtureProcessesCleaned'] = True
        report['success'] = True
    except Exception as error:
        report['error'] = type(error).__name__
        raise
    finally:
        opts.report.parent.mkdir(parents=True, exist_ok=True)
        opts.report.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))


if __name__ == '__main__':
    main()
