import copy
import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('capacity', HERE / 'capacity.py')
CAPACITY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAPACITY)
MODEL = json.loads((HERE.parents[1] / 'docs/system-design/capacity-model.json').read_text())


class CapacityPlanningTest(unittest.TestCase):
    def test_video_bandwidth_includes_every_viewer_not_only_publishers(self):
        r = CAPACITY.estimate(MODEL)
        self.assertEqual([60, 120], [m['sfu_payload_egress_gbps'] for m in r['media']])
        self.assertEqual([75, 150], [m['sfu_budgeted_egress_gbps'] for m in r['media']])
        self.assertEqual(27, r['media'][0]['viewer_payload_tb_per_hour'])
        self.assertEqual(1.125, r['media'][0]['publisher_budgeted_ingress_gbps'])
        self.assertFalse(r['production_capacity_proven'])

    def test_gateway_and_pools_are_sized_for_failure_and_max_replicas(self):
        r = CAPACITY.estimate(MODEL)
        self.assertEqual(10300, r['gateway']['total_connections'])
        self.assertEqual(5150, r['gateway']['connections_each_after_failure'])
        self.assertEqual(4060, r['total_auth_subject_checks_per_second'])
        self.assertTrue(r['gateway']['connection_budget_fits'])
        self.assertEqual(138, r['database']['all_max_replica_pools'])
        self.assertEqual(168, r['database']['total_with_reserve'])
        self.assertTrue(r['database']['budget_fits'])

    def test_room_indivisibility_is_not_hidden_by_aggregate_network_minimum(self):
        m = copy.deepcopy(MODEL)
        m['room_distribution'] = [{'rooms': 100, 'viewers': 100}]
        r = CAPACITY.estimate(m)['media'][1]
        self.assertEqual(10, r['aggregate_network_lower_bound_nodes'])
        self.assertEqual(11, r['example_packing_nodes_with_idle_spares'])

    def test_one_oversized_room_is_infeasible_even_when_more_nodes_exist(self):
        m = copy.deepcopy(MODEL)
        m['lessons'] = 1
        m['room_distribution'] = [{'rooms': 1, 'viewers': 10000}]
        self.assertFalse(CAPACITY.estimate(m)['media'][0]['room_fits_network_budget'])
        self.assertIsNone(CAPACITY.estimate(m)['media'][0]['example_packing_nodes_with_idle_spares'])

    def test_turn_is_extra_relay_work_not_a_discount_on_sfu_traffic(self):
        r = CAPACITY.estimate(MODEL)['media'][0]
        self.assertEqual(75, r['sfu_budgeted_egress_gbps'])
        self.assertEqual(22.5, r['turn_budgeted_egress_gbps'])
        self.assertEqual(45, r['turn_ingress_plus_egress_gbps'])

    def test_adding_replicas_cannot_silently_exceed_db_connection_budget(self):
        m = copy.deepcopy(MODEL)
        m['pools'][0]['max_replicas'] = 20
        self.assertFalse(CAPACITY.estimate(m)['database']['budget_fits'])

    def test_custom_lease_and_reconnect_windows_are_reflected_in_the_report(self):
        m = copy.deepcopy(MODEL)
        m.update(auth_lease_seconds=10, media_auth_lease_seconds=20, reconnect_window_seconds=60)
        r = CAPACITY.estimate(m)
        self.assertEqual(1530, r['total_auth_subject_checks_per_second'])
        self.assertIn('за 60 секунд', CAPACITY.markdown(r))
        self.assertIn('lease 10 секунд', CAPACITY.markdown(r))

    def test_invalid_models_fail_explicitly(self):
        for field, value in [('students', True), ('auth_lease_seconds', 0),
                             ('usable_nic_fraction', 2), ('network_overhead_factor', .5),
                             ('media_node_nic_gbps', float('nan')), ('failed_nodes', 3)]:
            with self.subTest(field=field):
                m = copy.deepcopy(MODEL)
                m[field] = value
                with self.assertRaises(ValueError): CAPACITY.estimate(m)
        m = copy.deepcopy(MODEL)
        m['room_distribution'][0]['rooms'] = 79
        with self.assertRaises(ValueError): CAPACITY.estimate(m)


if __name__ == '__main__':
    unittest.main()
