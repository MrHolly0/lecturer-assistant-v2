import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('renderer', Path(__file__).with_name('render.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DeploymentTest(unittest.TestCase):
    def config(self):
        return {'publicOrigin': 'https://lecture.example.edu',
                'images': {name: 'registry.example/' + name + '@sha256:' + 'a' * 64
                           for name in ['core', 'services', 'sfu', 'web', 'authority', 'converter']}}

    def test_manifest_spreads_replicas_and_mounts_shared_storage(self):
        data = module.render(self.config())['items']
        deployments = {i['metadata']['name']: i for i in data if i['kind'] == 'Deployment'}
        self.assertEqual(deployments['realtime']['spec']['replicas'], 3)
        for item in deployments.values():
            pod = item['spec']['template']['spec']
            self.assertFalse(pod['automountServiceAccountToken'])
            self.assertEqual(pod['topologySpreadConstraints'][0]['whenUnsatisfiable'], 'DoNotSchedule')
            self.assertEqual(item['spec']['strategy']['rollingUpdate']['maxUnavailable'], 0)
        for name in ['core', 'content-worker', 'converter']:
            self.assertEqual(deployments[name]['spec']['template']['spec']['volumes'][0]
                             ['persistentVolumeClaim']['claimName'], 'lecturer-blobs')
        for name in ['edge', 'authority', 'web']:
            self.assertTrue(deployments[name]['spec']['template']['spec']['containers'][0]['volumeMounts'])
        for name in ['edge', 'web']:
            container = deployments[name]['spec']['template']['spec']['containers'][0]
            self.assertEqual(container['securityContext']['runAsUser'], 101)
            self.assertEqual(container['ports'][0]['containerPort'], 8088)
        edge = next(i for i in data if i['kind'] == 'ConfigMap' and i['metadata']['name'] == 'edge')['data']
        self.assertNotIn('core-a', edge['edge.nginx.conf'])
        self.assertNotIn('realtime-a', edge['edge.nginx.conf'])
        self.assertIn('proxy_buffering off;', edge['edge.nginx.conf'])
        # nginx resolves upstreams itself, without search domains.
        self.assertIn('server core.lecturer.svc.cluster.local:8080 resolve', edge['edge.nginx.conf'])
        self.assertIn('server web.lecturer.svc.cluster.local:8088 resolve', edge['edge.nginx.conf'])
        self.assertNotRegex(edge['edge.nginx.conf'], r'server (core|realtime|web|media-control|max-adapter):')
        self.assertIn('kube-dns.kube-system.svc.cluster.local', edge['nginx-main.conf'])
        for name in ['core', 'content-worker']:
            container = deployments[name]['spec']['template']['spec']['containers'][0]
            self.assertEqual(container['livenessProbe']['httpGet']['path'], '/actuator/health/liveness')
            self.assertEqual(container['readinessProbe']['httpGet']['path'], '/actuator/health/readiness')

    def test_only_media_control_receives_sfu_signing_secret(self):
        data = module.render(self.config())['items']
        receivers = []
        for item in data:
            if item['kind'] != 'Deployment':
                continue
            for var in item['spec']['template']['spec']['containers'][0]['env']:
                if var['name'] == 'LIVEKIT_API_SECRET':
                    receivers.append(item['metadata']['name'])
        self.assertEqual(receivers, ['media-control'])

    def test_rejects_floating_application_images_and_plain_http(self):
        config = self.config()
        config['images']['core'] = 'core:latest'
        with self.assertRaises(ValueError):
            module.render(config)
        config = self.config()
        config['images']['core'] = 'core@sha256:' + 'z' * 64
        with self.assertRaises(ValueError):
            module.render(config)
        config = self.config()
        config['publicOrigin'] = 'http://example.edu'
        with self.assertRaises(ValueError):
            module.render(config)

    def test_autoscaling_budget_and_fail_safe_metric(self):
        config = self.config()
        config['autoscaling'] = {'enabled': True, 'prometheusAddress': 'http://prometheus:9090'}
        data = module.render(config)['items']
        scalers = {i['metadata']['name']: i for i in data if i['kind'] == 'ScaledObject'}
        self.assertEqual(set(scalers), {'realtime', 'content-worker', 'analytics'})
        gateway = scalers['realtime']['spec']
        self.assertEqual((gateway['minReplicaCount'], gateway['maxReplicaCount']), (3, 6))
        self.assertEqual(gateway['fallback']['replicas'], 6)
        trigger = gateway['triggers'][0]['metadata']
        self.assertEqual(trigger['ignoreNullValues'], 'false')
        self.assertIn('min(up{', trigger['query'])
        self.assertEqual(gateway['advanced']['horizontalPodAutoscalerConfig']['behavior']
                         ['scaleDown']['policies'][0]['value'], 1)
        hpas = {i['metadata']['name']: i for i in data if i['kind'] == 'HorizontalPodAutoscaler'}
        self.assertEqual(set(hpas), {'core', 'converter'})
        self.assertEqual(hpas['core']['spec']['maxReplicas'], 6)
        for item in data:
            if item['kind'] == 'Deployment' and item['metadata']['name'] in ['core', 'realtime', 'converter', 'content-worker', 'analytics']:
                self.assertNotIn('replicas', item['spec'])
        auth = [i for i in data if i['kind'] == 'TriggerAuthentication']
        self.assertEqual(len(auth), 2)
        self.assertTrue(all('connection' == i['spec']['secretTargetRef'][0]['key'] for i in auth))
        self.assertNotIn('password', str(auth).lower())

    def test_rejects_overcommitted_database_and_invalid_bounds(self):
        for overrides in [{'coreMax': 10}, {'databaseConnections': 140}, {'realtimeMax': 2},
                          {'contentMax': True}, {'analyticsMax': 17}, {'analyticsDatabaseConnections': 30},
                          {'prometheusAddress': 'http://user:password@prometheus:9090'}]:
            with self.subTest(overrides=overrides):
                config = self.config()
                config['autoscaling'] = {'enabled': True, 'prometheusAddress': 'http://prometheus:9090', **overrides}
                with self.assertRaises(ValueError):
                    module.render(config)

    def test_scraper_includes_draining_pods_until_their_connections_close(self):
        config = module.autoscaling.prometheus_config('lecturer')
        scrape = config['scrape_configs'][0]
        self.assertEqual(scrape['kubernetes_sd_configs'][0]['namespaces']['names'], ['lecturer'])
        self.assertNotIn('pod_ready', str(scrape))
        self.assertIn('8091', str(scrape))

    def test_local_quotas_stay_within_installation_budget_at_maximum_and_surge(self):
        config = self.config()
        for maximum in [2, 6, 16]:
            config['autoscaling'] = {'enabled': True, 'prometheusAddress': 'http://prometheus:9090',
                                     'coreMax': maximum, 'databaseConnections': 400}
            data = module.render(config)['items']
            core = next(i for i in data if i['kind'] == 'Deployment' and i['metadata']['name'] == 'core')
            env = {i['name']: i['value'] for i in core['spec']['template']['spec']['containers'][0]['env'] if 'value' in i}
            properties = (Path(__file__).parents[3] / 'core/src/main/resources/application.yml').read_text()
            for variable, ceiling in module.autoscaling.RATE_BUDGETS.values():
                self.assertIn('${' + variable + ':', properties)
                self.assertGreater(int(env[variable]), 0)
                self.assertLessEqual(int(env[variable]) * (maximum + 1), ceiling)
        for budgets in [{'writes': 0}, {'writes': True}, {'write': 100}, []]:
            config['autoscaling']['rateBudgets'] = budgets
            with self.assertRaises(ValueError):
                module.render(config)


if __name__ == '__main__':
    unittest.main()
