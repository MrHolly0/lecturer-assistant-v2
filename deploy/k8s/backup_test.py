import io
import json
import os
import shlex
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

BACKUP = Path(__file__).with_name('backup.sh')
FAKE = r'''
import io,json,os,sys,tarfile,time
from pathlib import Path
root=Path(os.environ['TEST_STATE']); args=sys.argv[1:]; mode=os.environ['TEST_MODE']
with (root/'calls').open('a') as f: f.write(json.dumps(args)+'\n')
if any(a.startswith('PGAPPNAME=') for a in args):
    (root/'held').touch()
    until=time.monotonic()+8
    while not (root/'released').exists() and time.monotonic()<until: time.sleep(.02)
elif 'psql' in args:
    sql=args[-1]
    if 'pg_terminate_backend' in sql: (root/'released').touch(); print('t')
    elif 'pg_locks' in sql:
        checks=root/'checks'; n=int(checks.read_text())+1 if checks.exists() else 1; checks.write_text(str(n))
        print('t' if (root/'held').exists() and not (mode=='lost-lock' and n>1) else 'f')
    else: print('50')
elif 'pg_dump' in args:
    if mode=='dump-fails': sys.exit(23)
    sys.stdout.buffer.write(b'PGDMPfixture')
elif 'pg_restore' in args:
    assert sys.stdin.buffer.read().startswith(b'PGDMP')
elif 'tar' in args:
    if mode=='tar-fails': sys.exit(24)
    with tarfile.open(fileobj=sys.stdout.buffer, mode='w|gz') as tar:
        item=tarfile.TarInfo('blobs/slide.txt'); content=b'snapshot'; item.size=len(content)
        tar.addfile(item,io.BytesIO(content))
'''


class BackupTest(unittest.TestCase):
    def run_backup(self, mode):
        state = tempfile.TemporaryDirectory()
        self.addCleanup(state.cleanup)
        root = Path(state.name)
        fake = root / 'fake.py'
        fake.write_text(FAKE)
        harness = '''set -eu
NS=lecturer
IMAGES=/nonexistent
require_init() { :; }
primary_pod() { echo "$1-primary"; }
step() { :; }
die() { echo "$*" >&2; exit 1; }
kc() { python3 "$TEST_STATE/fake.py" "$@"; }
. ''' + shlex.quote(str(BACKUP)) + '\ncmd_backup\n'
        result = subprocess.run(['sh', '-c', harness], text=True, capture_output=True, timeout=15,
                                env={**os.environ, 'TEST_STATE': str(root), 'TEST_MODE': mode,
                                     'BACKUP_DIR': str(root / 'backups')})
        calls = [json.loads(line) for line in (root / 'calls').read_text().splitlines()]
        return root, result, calls

    def test_consistent_snapshot_reads_actual_pvc_and_releases_guard(self):
        root, result, calls = self.run_backup('ok')
        self.assertEqual(result.returncode, 0, result.stderr)
        folders = list((root / 'backups').iterdir())
        self.assertEqual(len(folders), 1)
        self.assertFalse(folders[0].name.startswith('.partial-'))
        self.assertTrue((folders[0] / 'SHA256SUMS').exists())
        with tarfile.open(folders[0] / 'lecturer-blobs.tar.gz') as archive:
            self.assertEqual(archive.extractfile('blobs/slide.txt').read(), b'snapshot')
        archive_call = next(args for args in calls if 'tar' in args)
        self.assertIn('deployment/core', archive_call)
        self.assertIn('/data', archive_call)
        self.assertTrue((root / 'released').exists())

    def test_failures_never_publish_a_complete_backup_and_release_guard(self):
        for mode in ['dump-fails', 'tar-fails', 'lost-lock']:
            with self.subTest(mode=mode):
                root, result, calls = self.run_backup(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(list((root / 'backups').iterdir()), [])
                self.assertTrue((root / 'released').exists())


if __name__ == '__main__':
    unittest.main()
