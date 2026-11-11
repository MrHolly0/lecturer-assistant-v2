import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('render_site', Path(__file__).with_name('render-site.py'))
site_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site_module)

VERSIONS = site_module.read_env(Path(__file__).with_name('versions.env'))
IMAGES = {name: f'registry.lecturer.local/lecturer/{name}@sha256:' + 'b' * 64 for name in site_module.IMAGE_KEYS}
SECRETS = {key: 'value-' + key.lower() for key in site_module.RUNTIME_KEYS + [
    'REDIS_PASSWORD', 'CONTENT_DB_PASSWORD', 'CONTENT_SCALER_PASSWORD', 'ANALYTICS_SCALER_PASSWORD']}


def make_site(**overrides):
    env = {'PUBLIC_DOMAIN': 'lecturer-assistant.ru.tuna.am', 'NODE_COUNT': '3', **overrides}
    return site_module.Site(env, VERSIONS)


def by_kind(items, kind):
    return {item['metadata']['name']: item for item in items if item['kind'] == kind}


class SiteRenderTest(unittest.TestCase):
    def test_app_uses_reviewed_renderer_and_adds_site_pieces(self):
        items = site_module.app_items(make_site(), IMAGES)
        deployments = by_kind(items, 'Deployment')
        for name in ['core', 'content-worker', 'converter', 'realtime', 'event-publisher', 'analytics',
                     'media-control', 'web', 'edge', 'authority', 'redis', 'max-adapter']:
            self.assertIn(name, deployments)
        self.assertNotIn('Namespace', {item['kind'] for item in items})
        self.assertFalse(set(site_module.AUTOSCALING_KINDS) & {item['kind'] for item in items})
        claim = by_kind(items, 'PersistentVolumeClaim')['lecturer-blobs']
        self.assertEqual(claim['spec']['accessModes'], ['ReadWriteMany'])
        volume = by_kind(items, 'PersistentVolume')['lecturer-blobs']
        self.assertEqual(volume['spec']['nfs']['server'], 'lima-lecturer-k8s-1.internal')
        edge = by_kind(items, 'Service')['edge-public']
        self.assertEqual(edge['spec']['type'], 'LoadBalancer')
        self.assertEqual(edge['spec']['ports'][0], {'name': 'http', 'port': 18088, 'targetPort': 8088})

    def test_memory_requests_shrink_but_limits_stay(self):
        core = by_kind(site_module.app_items(make_site(), IMAGES), 'Deployment')['core']
        resources = core['spec']['template']['spec']['containers'][0]['resources']
        self.assertEqual(resources['limits']['memory'], '1Gi')
        self.assertEqual(resources['requests']['memory'], '512Mi')

    def test_app_manifests_carry_no_secret_values(self):
        text = json.dumps(site_module.app_items(make_site(), IMAGES))
        for value in SECRETS.values():
            self.assertNotIn(value, text)

    def test_max_adapter_is_single_and_builds_webhook_from_secret_path(self):
        adapter = by_kind(site_module.app_items(make_site(), IMAGES), 'Deployment')['max-adapter']
        self.assertEqual(adapter['spec']['replicas'], 1)
        self.assertEqual(adapter['spec']['strategy'], {'type': 'Recreate'})
        env = {var['name']: var for var in adapter['spec']['template']['spec']['containers'][0]['env']}
        names = list(env)
        self.assertLess(names.index('MAX_WEBHOOK_PATH'), names.index('MAX_WEBHOOK_URL'))
        self.assertEqual(env['MAX_WEBHOOK_URL']['value'], '$(PUBLIC_ORIGIN)$(MAX_WEBHOOK_PATH)')
        self.assertEqual(env['CORE_URL']['value'], 'http://authority:80')

    def test_data_layer_uses_synchronous_replication_only_with_three_nodes(self):
        three = by_kind(site_module.data_items(make_site()), 'Cluster')['app-db']['spec']
        self.assertEqual(three['instances'], 3)
        self.assertIn('synchronous', three['postgresql'])
        one = by_kind(site_module.data_items(make_site(NODE_COUNT='1')), 'Cluster')['app-db']['spec']
        self.assertEqual(one['instances'], 1)
        self.assertNotIn('synchronous', one['postgresql'])
        roles = {role['name'] for role in three['managed']['roles']}
        self.assertEqual(roles, {'content_worker', 'content_scaler'})

    def test_autoscaling_fits_database_budget(self):
        items = site_module.autoscaling_items(make_site(), IMAGES)
        self.assertEqual(set(by_kind(items, 'ScaledObject')), {'realtime', 'content-worker', 'analytics'})
        self.assertEqual(set(by_kind(items, 'HorizontalPodAutoscaler')), {'core', 'converter'})
        self.assertEqual(site_module.autoscaling_items(make_site(AUTOSCALING='false'), IMAGES), [])

    def test_secrets_runtime_stage_needs_cluster_credentials(self):
        site = make_site()
        with tempfile.TemporaryDirectory() as state:
            base = by_kind(site_module.secret_items(site, SECRETS, 'base', state), 'Secret')
            self.assertNotIn('lecturer-runtime', base)
            self.assertEqual(base['content-worker-db']['type'], 'kubernetes.io/basic-auth')
            with self.assertRaises(ValueError):
                site_module.secret_items(site, SECRETS, 'runtime', state)
            os.environ.update(RABBITMQ_USERNAME='user', RABBITMQ_PASSWORD='p@ss/word', ANALYTICS_DB_PASSWORD='x')
            try:
                runtime = by_kind(site_module.secret_items(site, SECRETS, 'runtime', state), 'Secret')
            finally:
                for key in ['RABBITMQ_USERNAME', 'RABBITMQ_PASSWORD', 'ANALYTICS_DB_PASSWORD']:
                    os.environ.pop(key)
            data = runtime['lecturer-runtime']['stringData']
            self.assertEqual(data['AMQP_URL'], 'amqp://user:p%40ss%2Fword@events.lecturer.svc:5672?heartbeat=10')
            for key in ['JWT_SECRET', 'ADMIN_SETUP_TOKEN', 'LIVEKIT_API_SECRET', 'ANALYTICS_DATABASE_URL']:
                self.assertIn(key, data)

    def test_every_secret_the_app_references_is_provided(self):
        site = make_site()
        os.environ.update(RABBITMQ_USERNAME='u', RABBITMQ_PASSWORD='p', ANALYTICS_DB_PASSWORD='a')
        try:
            with tempfile.TemporaryDirectory() as state:
                Path(state, 'turn.crt').write_text('crt')
                Path(state, 'turn.key').write_text('key')
                secrets = by_kind(site_module.secret_items(site, {**SECRETS, 'MAX_BOT_TOKEN': 't'}, 'runtime', state),
                                  'Secret')
        finally:
            for key in ['RABBITMQ_USERNAME', 'RABBITMQ_PASSWORD', 'ANALYTICS_DB_PASSWORD']:
                os.environ.pop(key)
        items = site_module.app_items(site, IMAGES) + site_module.autoscaling_items(site, IMAGES)
        for item in items:
            pod = item.get('spec', {}).get('template', {}).get('spec', {})
            for container in pod.get('containers', []):
                for var in container.get('env', []):
                    ref = var.get('valueFrom', {}).get('secretKeyRef')
                    if ref and ref['name'] in secrets and not ref.get('optional'):
                        self.assertIn(ref['key'], secrets[ref['name']]['stringData'], (item['metadata']['name'], ref))
                    elif ref and not ref.get('optional'):
                        self.assertIn(ref['name'], ['app-db-app', 'content-worker-db'])
            for volume in pod.get('volumes', []):
                if 'secret' in volume:
                    self.assertIn(volume['secret']['secretName'], secrets)
            if item['kind'] == 'TriggerAuthentication':
                self.assertIn(item['spec']['secretTargetRef'][0]['name'], secrets)

    def test_rejects_url_instead_of_domain(self):
        with self.assertRaises(ValueError):
            make_site(PUBLIC_DOMAIN='https://example.org')


if __name__ == '__main__':
    unittest.main()
