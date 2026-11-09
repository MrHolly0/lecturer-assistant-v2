#!/usr/bin/env python3
"""Read-only aggregate wait/transaction counters from the isolated lab. No SQL text or identities."""
import argparse
import json
import os
import subprocess
import time

QUERY = """
SET statement_timeout = '1500ms';
SELECT json_build_object('at', clock_timestamp(), 'waits', (
  SELECT json_agg(s) FROM (
    SELECT state, wait_event_type, wait_event, count(*) AS connections
    FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
    GROUP BY state, wait_event_type, wait_event
  ) s), 'transactions', (
    SELECT json_build_object('active', count(*) FILTER (WHERE state = 'active'),
      'idleInTransaction', count(*) FILTER (WHERE state = 'idle in transaction'),
      'longestAgeSeconds', max(extract(epoch FROM clock_timestamp() - xact_start)))
    FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
  ), 'database', (
    SELECT row_to_json(s) FROM (SELECT xact_commit, xact_rollback, blks_read, blks_hit,
      temp_bytes, deadlocks FROM pg_stat_database WHERE datname = current_database()) s));
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seconds', type=int, default=300)
    args = parser.parse_args()
    if os.environ.get('CAPACITY_ISOLATED') != 'true' or not 1 <= args.seconds <= 21600:
        parser.error('Requires CAPACITY_ISOLATED=true and a duration within 1..21600 seconds')
    container = 'lecturer-scale-lab-postgres-1'
    project = subprocess.check_output(['docker', 'inspect', '--format',
        '{{index .Config.Labels "com.docker.compose.project"}}', container], text=True).strip()
    if project != 'lecturer-scale-lab':
        raise RuntimeError('Wrong lab project')
    deadline = time.monotonic() + args.seconds
    while time.monotonic() < deadline:
        start = time.monotonic()
        try:
            result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-XqAt',
                '-U', 'lecturer', '-d', 'lecturer', '-v', 'ON_ERROR_STOP=1'],
                input=QUERY, text=True, capture_output=True, timeout=4, check=True)
            sample = json.loads(result.stdout)
        except (subprocess.SubprocessError, json.JSONDecodeError):
            sample = {'unavailable': True}
        sample['collectionMs'] = round((time.monotonic() - start) * 1000, 2)
        print(json.dumps(sample), flush=True)
        time.sleep(max(0, min(2 - (time.monotonic() - start), deadline - time.monotonic())))


if __name__ == '__main__':
    main()
