import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('single_vm_render', Path(__file__).with_name('render.py'))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)


class ApplianceTests(unittest.TestCase):
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


if __name__=='__main__':unittest.main()
