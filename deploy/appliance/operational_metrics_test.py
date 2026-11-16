import importlib.util
import json
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location('operational_metrics', Path(__file__).with_name('operational_metrics.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class OperationalMetricsTest(unittest.TestCase):
    def test_exports_aggregate_health_with_bounded_round_trips(self):
        calls = []
        def kc(*args):
            calls.append(args)
            if 'pods' in args:
                return json.dumps({'items': [
                    {'status': {'phase': 'Pending'}},
                    {'metadata': {'namespace': 'lecturer'}, 'status': {'phase': 'Running',
                     'containerStatuses': [{'ready': False, 'lastState': {'terminated': {'reason': 'OOMKilled'}}}]}}
                ]}).encode()
            if 'resourcequota' in args:
                return json.dumps({'status': {'used': {'limits.memory': '9Gi'}, 'hard': {'limits.memory': '10240Mi'}}}).encode()
            return b'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda 20000000 1000000 19000000 5% /data/blobs\n'
        queries = []
        def sql(db, command):
            queries.append((db, command))
            return 'postgres_lock_waiters|12\nupdate_needs_attention|1\n' if db == 'lecturer' else 'analytics_jobs_dead|2\n'
        result = m.collect(kc, sql)
        self.assertIn('lecturer_pods_pending 1.0\n', result)
        self.assertIn('lecturer_pods_oom 1.0\n', result)
        self.assertIn('lecturer_quota_memory_hard_bytes 10737418240.0\n', result)
        self.assertIn('lecturer_postgres_lock_waiters 12.0\n', result)
        self.assertIn('lecturer_analytics_jobs_dead 2.0\n', result)
        self.assertEqual(3, len(calls))
        self.assertEqual(2, len(queries))
        self.assertNotIn('person', result)
        self.assertNotIn('display_name', queries[0][1])


if __name__ == '__main__':
    unittest.main()
