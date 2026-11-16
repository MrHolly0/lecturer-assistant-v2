import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('single_vm_render', Path(__file__).with_name('render.py'))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)


class ApplianceTests(unittest.TestCase):
    def test_trusted_proxy_chain_overwrites_untrusted_headers_and_rejects_universal_trust(self):
        config = {'publicOrigin': 'https://fixture.example', 'tlsMode': 'proxy'}
        output = r.front_proxy(config, {'TRUSTED_PROXY_KEY': 'a' * 64})
        self.assertNotIn('trusted_proxies static', output)
        self.assertIn('header_up X-Lecturer-Client-IP {client_ip}', output)
        self.assertIn('header_up X-Forwarded-For {client_ip}', output)
        config['trustedProxyCidrs'] = ['192.0.2.10/32', '2001:db8::/64']
        output = r.front_proxy(config, {'TRUSTED_PROXY_KEY': 'a' * 64})
        self.assertIn('trusted_proxies_strict', output)
        for invalid in [['0.0.0.0/0'], ['::/0'], ['0.0.0.0/1', '128.0.0.0/1'],
                        ['::/1', '8000::/1'], ['bad\nproxy'], [True], '192.0.2.0/24']:
            config['trustedProxyCidrs'] = invalid
            with self.assertRaises(ValueError): r.front_proxy(config, {'TRUSTED_PROXY_KEY': 'a' * 64})

    def setUp(self):
        self.config = json.loads(Path(__file__).with_name('site.example.json').read_text())
        self.images = {key: f'registry.example.edu/{key}@sha256:'+'a'*64 for key in r.IMAGE_KEYS}

    def test_single_node_scaling_is_bounded_and_survives_reapply(self):
        app = r.app(self.config, self.images)
        deployments = {i['metadata']['name']: i for i in app if i['kind']=='Deployment'}
        self.assertNotIn('replicas', deployments['core']['spec'])
        self.assertEqual(1, deployments['max-adapter']['spec']['replicas'])
        self.assertEqual('Recreate', deployments['max-adapter']['spec']['strategy']['type'])
        scales = r.scaling(self.config, self.images)
        for item in scales:
            if item['kind']=='ScaledObject':
                self.assertEqual(1, item['spec']['minReplicaCount'])
                self.assertLessEqual(item['spec']['maxReplicaCount'], 3)
                self.assertEqual(item['spec']['maxReplicaCount'], item['spec']['fallback']['replicas'])
        self.assertEqual(2, len([i for i in scales if i['kind']=='HorizontalPodAutoscaler']))

    def test_database_budget_includes_update_surge(self):
        config=copy.deepcopy(self.config)
        config['scaling']['coreMax']=5
        with self.assertRaisesRegex(ValueError, 'surge'): r.validate(config,self.images)
        config['scaling']['databaseConnections']=180
        config['podMemoryBudgetMi']=13312
        config['clusterMemoryMi']=16384
        r.validate(config,self.images)

    def test_persistent_single_node_storage_and_private_services(self):
        values={key:'a'*64 for key in ['PG_SUPERUSER_PASSWORD','ANALYTICS_SUPERUSER_PASSWORD',
                                     'DB_PASSWORD','ANALYTICS_DB_PASSWORD','RABBITMQ_PASSWORD','REDIS_PASSWORD']}
        data=r.data(self.config,values)
        stateful=[i for i in data if i['kind']=='StatefulSet']
        self.assertEqual(3,len(stateful))
        self.assertTrue(all(i['spec']['replicas']==1 for i in stateful))
        self.assertTrue(all(i['spec']['volumeClaimTemplates'] for i in stateful))
        self.assertFalse(any(i['kind']=='Service' and i['spec'].get('type')=='LoadBalancer' for i in data))
        self.assertEqual(['ReadWriteOnce'],next(i for i in data if i['kind']=='PersistentVolumeClaim')['spec']['accessModes'])

    def test_generic_web_uses_only_public_runtime_config(self):
        items=r.app(self.config,self.images)
        runtime=next(i for i in items if i['metadata']['name']=='public-config')
        self.assertEqual({'runtime-config.js'},set(runtime['data']))
        self.assertIn('institution_bot',runtime['data']['runtime-config.js'])
        for bad in ['https://max.ru/x', 'x\nalert(1)', '<script>']:
            config=copy.deepcopy(self.config);config['maxBotName']=bad
            with self.assertRaises(ValueError):r.validate(config,self.images)

    def test_mutable_images_and_non_https_origin_rejected(self):
        self.images['web']='example/web:latest'
        with self.assertRaises(ValueError):r.validate(self.config,self.images)

    def test_maximum_and_serial_surge_fit_the_emitted_memory_budget(self):
        budget=r.resource_budget(self.config,self.images)
        self.assertEqual(9408,budget['maximumMi'])
        self.assertLessEqual(budget['maximumMi']+budget['updateSurgeMi'],budget['quotaMi'])
        self.assertLessEqual(budget['quotaMi']+budget['platformMi'],budget['clusterMi'])
        for field in ['clusterMemoryMi','platformMemoryMi','clusterCpus']:
            bad=copy.deepcopy(self.config);bad[field]='1; invalid'
            with self.assertRaises(ValueError):r.validate(bad,self.images)

    def test_converter_has_only_scratch_and_no_egress(self):
        items=r.app(self.config,self.images)
        converter=next(i for i in items if i['kind']=='Deployment' and i['metadata']['name']=='converter')['spec']['template']['spec']
        self.assertEqual({'conversion','temporary'},set(v['name'] for v in converter['volumes']))
        self.assertTrue(converter['containers'][0]['securityContext']['runAsNonRoot'])
        policy=next(i for i in items if i['kind']=='NetworkPolicy' and i['metadata']['name']=='converter-isolation')
        self.assertEqual([],policy['spec']['egress'])
        for item in items:
            if item['kind']=='Deployment' and item['metadata']['name'] in ['realtime','analytics','event-publisher','media-control']:
                container=item['spec']['template']['spec']['containers'][0]
                heap=next(e['value'] for e in container['env'] if e['name']=='NODE_OPTIONS')
                self.assertLess(int(heap.split('=')[-1]),r.site_renderer.mebibytes(container['resources']['limits']['memory'])*.7)


if __name__=='__main__':unittest.main()
