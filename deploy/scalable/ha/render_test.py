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


if __name__ == '__main__':
    unittest.main()
