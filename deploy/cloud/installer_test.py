import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[2]


class InstallerHealthTest(unittest.TestCase):
    def test_failed_public_health_fails_deployment_without_touching_docker_or_cron(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ['deploy/cloud/lecturer.sh', 'deploy/stand/check.sh']:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(ROOT / name, target)
            (root / '.env').write_text('JWT_SECRET=isolated-test-value\nSITE_DOMAIN=example.invalid\nPUBLIC_MODE=tunnel\n')
            binaries = root / 'bin'
            binaries.mkdir()
            for name, body in {
                'docker': 'exit 0', 'crontab': 'cat >/dev/null; exit 0', 'sleep': 'exit 0',
                'systemctl': 'exit 0', 'curl': "printf '503'", 'openssl': 'exit 1'
            }.items():
                script = binaries / name
                script.write_text('#!/bin/sh\n' + body + '\n')
                script.chmod(0o700)
            result = subprocess.run(['sh', str(root / 'deploy/cloud/lecturer.sh'), 'up'],
                                    capture_output=True, text=True, timeout=5,
                                    env={**os.environ, 'PATH': str(binaries) + ':' + os.environ['PATH']},
                                    stdin=subprocess.DEVNULL)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('Сайт и мини-приложение:', result.stdout)
            self.assertIn('FAIL', result.stdout)


if __name__ == '__main__':
    unittest.main()
