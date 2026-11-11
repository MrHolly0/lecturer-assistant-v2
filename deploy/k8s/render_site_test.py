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
SECRETS = {key: 'value-' + key.lower() + '-' + 'x' * 32 for key in site_module.RUNTIME_KEYS + [
    'REDIS_PASSWORD', 'CONTENT_DB_PASSWORD', 'CONTENT_SCALER_PASSWORD', 'ANALYTICS_SCALER_PASSWORD']}


def make_site(**overrides):
    # Default for these tests: the full profile on three nodes behind a tunnel.
    env = {'PUBLIC_DOMAIN': 'lecturer-assistant.ru.tuna.am', 'NODE_COUNT': '3', 'PROFILE': 'full',
           'MEMORY_REQUEST_RATIO': '0.5', **overrides}
    return site_module.Site(env, VERSIONS)


def light_site(**overrides):
    return site_module.Site({'PUBLIC_DOMAIN': 'lecturer-assistant.ru.tuna.am', **overrides}, VERSIONS)


def linux_site(**overrides):
    env = {'PUBLIC_DOMAIN': 'lecture.example.edu', 'PLATFORM': 'linux', 'ACME_EMAIL': 'ops@example.edu',
           'SERVER_IP': '10.0.0.1', 'SERVER_NODE': 'node-1', **overrides}
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
        one = by_kind(site_module.data_items(light_site()), 'Cluster')['app-db']['spec']
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

    def test_mac_defaults_to_light_profile_with_one_copy_of_everything(self):
        site = light_site()
        self.assertEqual((site.platform, site.profile_name, site.public_mode, site.autoscaling),
                         ('lima', 'light', 'tunnel', False))
        items = site_module.app_items(site, IMAGES)
        self.assertNotIn('PodDisruptionBudget', {item['kind'] for item in items})
        for name, item in by_kind(items, 'Deployment').items():
            self.assertEqual(item['spec']['replicas'], 1, name)
            self.assertEqual(item['spec']['template']['spec']['containers'][0]['resources']['requests'].get('cpu'),
                             '50m' if name not in ('redis', 'max-adapter') else '50m')
        core = by_kind(items, 'Deployment')['core']['spec']['template']['spec']['containers'][0]['resources']
        self.assertEqual(core['requests']['memory'], '256Mi')
        self.assertEqual(core['limits']['memory'], '1Gi')
        self.assertEqual(site_module.autoscaling_items(site, IMAGES), [])
        platform = {item['kind'] for item in site_module.platform_items(site)}
        self.assertNotIn('ConfigMap', platform)  # no Prometheus without autoscaling

    def test_light_profile_reserves_far_less_memory_than_full(self):
        def reserved(site):
            total = 0
            for item in site_module.app_items(site, IMAGES) + site_module.data_items(site):
                if item['kind'] == 'Deployment':
                    pod = item['spec']['template']['spec']
                    total += item['spec'].get('replicas', 2) * site_module.mebibytes(
                        pod['containers'][0]['resources']['requests']['memory'])
                elif item['kind'] in ('Cluster', 'RabbitmqCluster'):
                    count = item['spec'].get('instances') or item['spec']['replicas']
                    total += count * site_module.mebibytes(item['spec']['resources']['requests']['memory'])
            return total
        light = reserved(light_site())
        full = reserved(linux_site())
        self.assertLess(light, 3 * 1024)
        self.assertGreater(full, 4 * light)

    def test_linux_full_profile_uses_reviewed_sizes_ingress_and_private_registry(self):
        site = linux_site()
        self.assertEqual((site.profile_name, site.public_mode, site.autoscaling, site.nodes), ('full', 'ingress', True, 3))
        data = by_kind(site_module.data_items(site), 'Cluster')['app-db']['spec']
        self.assertEqual(data['resources']['requests'], {'cpu': '2', 'memory': '4Gi'})
        self.assertEqual(data['storage']['size'], '100Gi')
        self.assertIn('synchronous', data['postgresql'])
        items = site_module.app_items(site, IMAGES)
        core = by_kind(items, 'Deployment')['core']['spec']['template']['spec']['containers'][0]['resources']
        self.assertEqual(core['requests']['memory'], core['limits']['memory'])
        ingress = by_kind(items, 'Ingress')['edge']
        self.assertEqual(ingress['spec']['tls'][0]['hosts'], ['lecture.example.edu'])
        self.assertEqual(ingress['spec']['rules'][0]['http']['paths'][0]['backend']['service'],
                         {'name': 'edge', 'port': {'number': 8088}})
        self.assertIn('ClusterIssuer', {item['kind'] for item in items})
        self.assertNotIn('edge-public', by_kind(items, 'Service'))
        self.assertEqual(by_kind(items, 'PersistentVolume')['lecturer-blobs']['spec']['nfs']['server'], '10.0.0.1')
        registry = by_kind(site_module.platform_items(site), 'Deployment')['registry']
        port = registry['spec']['template']['spec']['containers'][0]['ports'][0]
        self.assertEqual((port['hostPort'], port['hostIP']), (5000, '10.0.0.1'))
        self.assertEqual(registry['spec']['template']['spec']['nodeSelector'], {'kubernetes.io/hostname': 'node-1'})
        scaled = by_kind(site_module.autoscaling_items(site, IMAGES), 'ScaledObject')['realtime']
        self.assertEqual(scaled['spec']['maxReplicaCount'], 6)

    def test_media_node_announces_configured_public_ip(self):
        def livekit(site):
            with tempfile.TemporaryDirectory() as state:
                return by_kind(site_module.secret_items(site, SECRETS, 'base', state), 'Secret')[
                    'livekit-config']['stringData']['livekit.yaml']
        self.assertIn('  node_ip: 203.0.113.7', livekit(linux_site(MEDIA_PUBLIC_IP='203.0.113.7')))
        self.assertIn('use_external_ip: false', livekit(linux_site()))
        self.assertNotIn('node_ip', livekit(light_site()))
        with self.assertRaises(ValueError):
            linux_site(MEDIA_PUBLIC_IP='media.example.edu')

    def test_ingress_needs_acme_email(self):
        with self.assertRaises(ValueError):
            linux_site(ACME_EMAIL='')

    def test_rejects_url_instead_of_domain(self):
        with self.assertRaises(ValueError):
            make_site(PUBLIC_DOMAIN='https://example.org')


if __name__ == '__main__':
    unittest.main()
