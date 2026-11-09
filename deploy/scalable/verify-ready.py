#!/usr/bin/env python3
"""Read-only gate for this isolated Compose lab. Never starts/restarts services or changes data."""
import json
import argparse
import subprocess
import sys

SERVICES = ['postgres', 'analytics-db', 'rabbit-a', 'rabbit-b', 'rabbit-c', 'redis',
    'core-a', 'core-b', 'converter', 'content-worker', 'authority', 'realtime-a',
    'realtime-b', 'realtime-c', 'event-publisher', 'analytics', 'sfu', 'media-control', 'web', 'edge']
FORMAT = ('{"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
          '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
          '"running":{{json .State.Running}},'
          '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}')


def main(expected_stopped=()):
    report = {'ready': False, 'services': [], 'gateways': [], 'expectedStopped': list(expected_stopped)}
    try:
        result = subprocess.run(['docker', 'inspect', '--format', FORMAT,
            *[f'lecturer-scale-lab-{s}-1' for s in SERVICES]],
            text=True, capture_output=True, check=True, timeout=10)
        report['services'] = [json.loads(line) for line in result.stdout.splitlines()]
        if len(report['services']) != len(SERVICES) or any(
            s['project'] != 'lecturer-scale-lab'
            or (s['running'] if s['service'] in expected_stopped else
                not s['running'] or s['health'] not in ['healthy', 'none'])
            for s in report['services']):
            return report
        # Inspect health can lag one interval. Check current authority+broker readiness too.
        probe = "fetch('http://127.0.0.1:8091/ready',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        for suffix in ['a', 'b', 'c']:
            if f'realtime-{suffix}' in expected_stopped:
                continue
            result = subprocess.run(['docker', 'exec', f'lecturer-scale-lab-realtime-{suffix}-1',
                'node', '-e', probe], capture_output=True, timeout=4)
            report['gateways'].append({'name': suffix, 'ready': result.returncode == 0})
        report['ready'] = all(g['ready'] for g in report['gateways'])
    except (subprocess.SubprocessError, json.JSONDecodeError, OSError):
        report['unavailable'] = True
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--expect-stopped', action='append', default=[],
        choices=['core-a', 'core-b', 'realtime-a', 'realtime-b', 'realtime-c', 'rabbit-a', 'rabbit-b', 'rabbit-c'])
    args = parser.parse_args()
    if any(sum(s.startswith(prefix) for s in args.expect_stopped) > 1 for prefix in ['core-', 'realtime-', 'rabbit-']):
        parser.error('At most one stopped replica of each role can be expected')
    result = main(args.expect_stopped)
    print(json.dumps(result))
    sys.exit(0 if result['ready'] else 1)
