#!/usr/bin/env python3
"""Full control-path load from Linux, bypassing Docker Desktop's published-port forwarding.

Uses only the isolated Compose network and pre-created synthetic fixture. No real env is mounted.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stages', default='10x100,100x100')
    parser.add_argument('--fixture', type=Path, default=Path('/tmp/lecturer-scale-fixture.json'))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    for stage in args.stages.split(','):
        if not re.fullmatch(r'\d+x\d+', stage):
            parser.error('Invalid stages')
        lessons, students = map(int, stage.split('x'))
        if not 1 <= lessons <= 100 or not 1 <= students <= 150:
            parser.error('Stage exceeds 100x150 safety bound')
    fixture = args.fixture.resolve(strict=True)
    data = json.loads(fixture.read_text())
    if not all(isinstance(data.get(k), str) and data[k] for k in ['email', 'password']):
        parser.error('A pre-created synthetic admin fixture is required')
    del data
    destination = (args.output or ROOT / 'artifacts' /
        ('scalable-linux-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))).resolve()
    if not destination.is_relative_to(ROOT / 'artifacts'):
        parser.error('Output must be a new directory under artifacts/')
    subprocess.run([sys.executable, str(ROOT / 'deploy/scalable/verify-ready.py')], check=True)
    destination.mkdir(parents=True, exist_ok=False)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT))
    environment = json.loads(subprocess.check_output(['docker', 'info', '--format',
        '{"docker":{{json .ServerVersion}},"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}}}'], text=True))
    environment.update({'revision': revision, 'dirty': dirty, 'generatorImage': IMAGE,
        'generatorLimits': {'cpus': 2, 'memoryBytes': 1073741824},
        'mediaIncluded': False, 'route': 'Linux generator -> edge -> gateway/authority/application',
        'stages': args.stages})
    (destination / 'environment.json').write_text(json.dumps(environment, indent=2))
    name = 'lecturer-scale-load-' + uuid.uuid4().hex[:12]
    command = ['docker', 'run', '--rm', '--init', '--name', name,
        '--label', 'lecturer.test=capacity', '--network', 'lecturer-scale-lab_default',
        '--cpus', '2', '--memory', '1g', '--pids-limit', '128',
        '--ulimit', 'nofile=65536:65536', '--workdir', '/work']
    mounts = [(ROOT / 'e2e', '/work/e2e', True),
        (ROOT / 'services/common', '/work/services/common', True),
        (ROOT / 'core/src/test/resources/golden/content/v1-report.pdf',
         '/work/core/src/test/resources/golden/content/v1-report.pdf', True),
        (fixture, '/fixture.json', True), (destination, '/output', False)]
    for source, target, readonly in mounts:
        command.extend(['--mount', f'type=bind,src={source},dst={target}' + (',readonly' if readonly else '')])
    for key, value in {'CAPACITY_ISOLATED': 'true', 'CAPACITY_TRANSPORT_GATEWAY': 'true',
        'ADMIN_SETUP_TOKEN': 'unused_precreated_fixture', 'CAPACITY_ADMIN_FIXTURE': '/fixture.json',
        'BASE_URL': 'http://capacity-caddy:8088', 'CAPACITY_STAGES': args.stages,
        'CAPACITY_OUTPUT': '/output', 'REVISION': revision}.items():
        command.extend(['--env', f'{key}={value}'])
    command.extend([IMAGE, 'node', 'e2e/system-capacity.mjs'])
    try:
        with (destination / 'progress.jsonl').open('w') as progress:
            result = subprocess.run(command, stdout=progress, stderr=progress)
        return result.returncode
    finally:
        # Only this invocation's uniquely named generator, including interrupted runs.
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=15)
        print(json.dumps({'output': str(destination), **environment}))


if __name__ == '__main__':
    sys.exit(main())
