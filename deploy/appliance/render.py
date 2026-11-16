#!/usr/bin/env python3
"""Single-node application topology. Reuses the distributed application's routes and contracts."""
import importlib.util
import ipaddress
import json
from pathlib import Path
import re
from types import SimpleNamespace
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[2]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

site_renderer = load('appliance_site', ROOT/'deploy/k8s/render-site.py')
ha = site_renderer.renderer
IMAGE_KEYS = site_renderer.IMAGE_KEYS
NS = 'lecturer'


def validate(config, images):
    origin = urlparse(config['publicOrigin'])
    if origin.scheme != 'https' or not origin.hostname or origin.path not in ['', '/'] or origin.username \
            or origin.password or origin.query or origin.fragment:
        raise ValueError('publicOrigin must be an HTTPS origin')
    if config.get('mediaPublicIp'):
        ipaddress.IPv4Address(config['mediaPublicIp'])
    if config.get('maxBotName') and not re.fullmatch(r'[A-Za-z0-9_]{3,80}', config['maxBotName']):
        raise ValueError('maxBotName must be a bare bot name')
    if config.get('tlsMode', 'proxy') not in ['proxy', 'automatic']:
        raise ValueError('tlsMode must be proxy or automatic')
    for key, default, low, high in [('podMemoryBudgetMi', 10240, 7000, 262144), ('podCpuBudget', 6, 2, 256)]:
        value = config.get(key, default)
        if type(value) is not int or not low <= value <= high:
            raise ValueError('Invalid resource budget: '+key)
    updates = config.get('updates')
    if updates:
        parsed = urlparse(updates['catalogUrl'])
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise ValueError('Signed update catalog requires an HTTPS URL without credentials')
        if not updates.get('publicKey', '').startswith('-----BEGIN PUBLIC KEY-----'):
            raise ValueError('An Ed25519 PEM release verification key is required')
    if set(images) != set(IMAGE_KEYS):
        raise ValueError('Expected exactly: ' + ', '.join(IMAGE_KEYS))
    if any(not re.fullmatch(r'[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}', value) for value in images.values()):
        raise ValueError('Application images must use immutable SHA256 digests')
    for name, floor, ceiling in [('coreMax', 1, 8), ('realtimeMax', 1, 8), ('contentMax', 1, 4),
                                 ('converterMax', 1, 4), ('analyticsMax', 1, 4)]:
        value = config['scaling'][name]
        if type(value) is not int or not floor <= value <= ceiling:
            raise ValueError('Invalid scaling bound: ' + name)
    connections = config['scaling'].get('databaseConnections', 120)
    # Include one core and one worker rolling-update surge, not just the steady state.
    needed = (config['scaling']['coreMax'] + 1) * 16 + (config['scaling']['contentMax'] + 1) * 4 + 30
    if not needed <= connections <= 500:
        raise ValueError(f'Database budget must cover {needed} connections including update surge')


def obj(kind, name, spec=None, **fields):
    api = 'apps/v1' if kind in ['StatefulSet', 'Deployment'] else 'v1'
    return {'apiVersion': api, 'kind': kind, 'metadata': {'name': name, 'namespace': NS},
            **({'spec': spec} if spec is not None else {}), **fields}


def secret(name, data):
    return obj('Secret', name, stringData=data)


def ref(name, key):
    return {'valueFrom': {'secretKeyRef': {'name': name, 'key': key}}}


def envset(container, values):
    names = set(values)
    container['env'] = [e for e in container.get('env', []) if e['name'] not in names]
    container['env'] += [{'name': k, 'value': str(v)} for k, v in values.items()]


def database(name, database_name, password, connections, storage):
    labels = {'app.kubernetes.io/component': name}
    container = {'name': 'postgres', 'image': 'postgres:16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139',
                 'args': ['-c', f'max_connections={connections}', '-c', 'shared_buffers=64MB',
                          '-c', 'wal_level=replica', '-c', 'password_encryption=scram-sha-256'],
                 'env': [{'name': 'POSTGRES_PASSWORD', **ref(name+'-superuser', 'password')},
                         {'name': 'POSTGRES_DB', 'value': database_name},
                         {'name': 'PGDATA', 'value': '/var/lib/postgresql/data/pgdata'}],
                 'resources': {'requests': {'cpu': '100m', 'memory': '160Mi'},
                               'limits': {'cpu': '2', 'memory': '768Mi'}},
                 'readinessProbe': {'exec': {'command': ['pg_isready', '-U', 'postgres', '-d', database_name]},
                                    'periodSeconds': 3},
                 'volumeMounts': [{'name': 'data', 'mountPath': '/var/lib/postgresql/data'}]}
    return [secret(name+'-superuser', {'password': password}),
            obj('Service', name+'-rw', {'selector': labels, 'ports': [{'port': 5432}]}),
            obj('StatefulSet', name, {'serviceName': name+'-rw', 'replicas': 1,
                'selector': {'matchLabels': labels}, 'template': {'metadata': {'labels': labels}, 'spec': {
                    'automountServiceAccountToken': False, 'securityContext': {'fsGroup': 70},
                    'containers': [container]}}, 'volumeClaimTemplates': [
                        {'metadata': {'name': 'data'}, 'spec': {'accessModes': ['ReadWriteOnce'],
                         'storageClassName': 'local-path', 'resources': {'requests': {'storage': storage}}}}]})]


def data(config, values):
    items = [obj('ResourceQuota', 'application-budget', {'hard': {
        'requests.cpu': str(config.get('podCpuBudget', 6)),
        'limits.memory': str(config.get('podMemoryBudgetMi', 10240))+'Mi',
        'persistentvolumeclaims': '8', 'pods': '40'}})]
    items += database('app-db', 'lecturer', values['PG_SUPERUSER_PASSWORD'],
                     config['scaling'].get('databaseConnections', 120), '20Gi')
    items += database('analytics-db', 'analytics', values['ANALYTICS_SUPERUSER_PASSWORD'], 60, '10Gi')
    items += [secret('app-db-app', {'username': 'lecturer', 'password': values['DB_PASSWORD']}),
              secret('analytics-db-app', {'username': 'analytics', 'password': values['ANALYTICS_DB_PASSWORD']}),
              obj('PersistentVolumeClaim', 'lecturer-blobs', {'accessModes': ['ReadWriteOnce'],
                   'storageClassName': 'local-path', 'resources': {'requests': {'storage': '40Gi'}}})]
    labels = {'app.kubernetes.io/component': 'events'}
    container = {'name': 'rabbitmq', 'image': 'rabbitmq:4.2-alpine@sha256:cd4f5c5bb4ffe530dba84770a8d139b8518470cdd385fec9cf014ebfff6bb009',
                 'env': [{'name': 'RABBITMQ_DEFAULT_USER', 'value': 'lecturer'},
                         {'name': 'RABBITMQ_DEFAULT_PASS', **ref('events-auth', 'password')},
                         {'name': 'RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS', 'value': '+S 2:2 +A 4'}],
                 'resources': {'requests': {'cpu': '100m', 'memory': '192Mi'},
                               'limits': {'cpu': '1', 'memory': '512Mi'}},
                 'readinessProbe': {'exec': {'command': ['rabbitmq-diagnostics', '-q', 'ping']},
                                    'periodSeconds': 10, 'timeoutSeconds': 5},
                 'volumeMounts': [{'name': 'data', 'mountPath': '/var/lib/rabbitmq'},
                                  {'name': 'config', 'mountPath': '/etc/rabbitmq/conf.d/20-site.conf',
                                   'subPath': 'rabbitmq.conf'}]}
    items += [secret('events-auth', {'password': values['RABBITMQ_PASSWORD']}),
              obj('ConfigMap', 'events-config', data={'rabbitmq.conf':
                   'vm_memory_high_watermark.absolute = 350MiB\ndisk_free_limit.absolute = 512MB\n'}),
              obj('Service', 'events', {'selector': labels, 'ports': [{'port': 5672}]}),
              obj('StatefulSet', 'events', {'serviceName': 'events', 'replicas': 1,
                  'selector': {'matchLabels': labels}, 'template': {'metadata': {'labels': labels}, 'spec': {
                      'automountServiceAccountToken': False,
                      # fsGroup recursively widens the Erlang cookie to group-readable on
                      # a new pod. Erlang then refuses to start against its existing PVC.
                      'initContainers': [{'name': 'data-permissions', 'image': container['image'],
                          'command': ['sh', '-ec', 'chown 999:999 /var/lib/rabbitmq; chmod 700 /var/lib/rabbitmq; '
                              'if [ -f /var/lib/rabbitmq/.erlang.cookie ]; then '
                              'chown 999:999 /var/lib/rabbitmq/.erlang.cookie; '
                              'chmod 600 /var/lib/rabbitmq/.erlang.cookie; fi'],
                          'resources': {'requests': {'cpu': '5m', 'memory': '8Mi'},
                                        'limits': {'cpu': '100m', 'memory': '64Mi'}},
                          'volumeMounts': [{'name': 'data', 'mountPath': '/var/lib/rabbitmq'}]}],
                      'containers': [container], 'volumes': [{'name': 'config', 'configMap': {'name': 'events-config'}}]}},
                  'volumeClaimTemplates': [{'metadata': {'name': 'data'}, 'spec': {
                      'accessModes': ['ReadWriteOnce'], 'storageClassName': 'local-path',
                      'resources': {'requests': {'storage': '5Gi'}}}}]})]
    site = SimpleNamespace(namespace=NS, versions={'REDIS_IMAGE': 'redis:7.4-alpine@sha256:c5d34a98396a4775e223c74e929162c35c5a2182901ba26b50ade939941ce14b'})
    items += site_renderer.redis_items(site)
    items += [secret('redis-auth', {'password': values['REDIS_PASSWORD']})]
    return items


def secrets(config, values):
    runtime = {k: values[k] for k in site_renderer.RUNTIME_KEYS}
    runtime.update(AMQP_URL=f'amqp://lecturer:{quote(values["RABBITMQ_PASSWORD"], safe="")}@events:5672?heartbeat=10',
                   ANALYTICS_DATABASE_URL=f'postgres://analytics:{quote(values["ANALYTICS_DB_PASSWORD"], safe="")}@analytics-db-rw:5432/analytics')
    if values.get('MAX_BOT_TOKEN'):
        runtime['MAX_BOT_TOKEN'] = values['MAX_BOT_TOKEN']
    if config.get('updates'):
        runtime.update(INSTALLATION_UPDATES_ENABLED='true',
                       INSTALLATION_OPERATOR_KEY=values['INSTALLATION_OPERATOR_KEY'],
                       INSTALLATION_RELEASE_PUBLIC_KEY=config['updates']['publicKey'])
    site = SimpleNamespace(namespace=NS, media_ip=config.get('mediaPublicIp', ''))
    return [secret('lecturer-runtime', runtime),
            secret('content-worker-db', {'username': 'content_worker', 'password': values['CONTENT_DB_PASSWORD']}),
            secret('lecturer-scaling-content', {'connection':
                f'postgresql://content_scaler:{values["CONTENT_SCALER_PASSWORD"]}@app-db-rw.{NS}.svc.cluster.local:5432/lecturer?sslmode=disable'}),
            secret('lecturer-scaling-analytics', {'connection':
                f'postgresql://analytics_scaler:{values["ANALYTICS_SCALER_PASSWORD"]}@analytics-db-rw.{NS}.svc.cluster.local:5432/analytics?sslmode=disable'}),
            secret('livekit-config', {'livekit.yaml': site_renderer.livekit_config(site, values)}),
            secret('turn-tls', {})]


# Memory requests describe the small installation; maxima are capacity ceilings, not guarantees.
SIZES = {'core': (256, 768, '250m'), 'content-worker': (192, 512, '100m'),
         'converter': (128, 1024, '250m'), 'realtime': (64, 384, '100m'),
         'event-publisher': (48, 192, '50m'), 'analytics': (64, 256, '100m'),
         'media-control': (48, 192, '50m'), 'web': (16, 64, '25m'),
         'edge': (32, 128, '50m'), 'authority': (24, 96, '25m')}


def app(config, images):
    validate(config, images)
    scaling = {**config['scaling'], 'singleNode': True, 'enabled': True,
               'prometheusAddress': 'http://prometheus.monitoring.svc.cluster.local:9090'}
    manifest = ha.render({'images': images, 'namespace': NS, 'publicOrigin': config['publicOrigin'],
                          'autoscaling': scaling})['items']
    app_items = [i for i in manifest if i['kind'] not in ['Namespace', 'PodDisruptionBudget',
                                                       'ScaledObject', 'TriggerAuthentication', 'HorizontalPodAutoscaler']]
    for item in app_items:
        name = item['metadata']['name']
        if item['kind'] == 'Deployment':
            # Do not reset HPA desired counts when the configuration is applied again.
            if name not in ['core', 'content-worker', 'converter', 'realtime', 'analytics']:
                item['spec']['replicas'] = 1
            container = item['spec']['template']['spec']['containers'][0]
            request, limit, cpu = SIZES[name]
            container['resources'] = {'requests': {'cpu': cpu, 'memory': f'{request}Mi'},
                                      'limits': {'cpu': '2', 'memory': f'{limit}Mi'}}
            if name in ['core', 'content-worker']:
                envset(container, {'JAVA_TOOL_OPTIONS': '-XX:MaxRAMPercentage=60 -XX:ActiveProcessorCount=2 -Xss512k -XX:+ExitOnOutOfMemoryError'})
            if name == 'converter':
                envset(container, {'CONVERTER_MAX_CONVERSIONS': 1})
            if name == 'web':
                pod = item['spec']['template']['spec']
                pod['volumes'].append({'name': 'runtime', 'configMap': {'name': 'public-config'}})
                container['volumeMounts'].append({'name': 'runtime', 'mountPath': '/usr/share/nginx/html/runtime-config.js',
                                                  'subPath': 'runtime-config.js'})
            if name == 'media-control':
                envset(container, {'LIVEKIT_PUBLIC_URL': config['publicOrigin'].replace('https:', 'wss:')})
        if item['kind'] == 'DaemonSet':
            container = item['spec']['template']['spec']['containers'][0]
            container['resources'] = {'requests': {'cpu': '100m', 'memory': '192Mi'},
                                      'limits': {'cpu': '4', 'memory': '1024Mi'}}
        if item['kind'] == 'Service' and name == 'edge':
            item['spec'].update(type='NodePort')
            item['spec']['ports'][0]['nodePort'] = 30080
    app_items += [obj('ConfigMap', 'public-config', data={'runtime-config.js':
                       'window.__LECTURER_CONFIG__ = ' + json.dumps({'maxBotName': config.get('maxBotName', '')}) + ';\n'})]
    site = SimpleNamespace(namespace=NS, origin=config['publicOrigin'], register_webhook=
                            str(config.get('registerMaxWebhook', True)).lower())
    app_items += site_renderer.max_adapter_items(site, images)
    return app_items


def scaling(config, images):
    values = {'images': images, 'namespace': NS, 'publicOrigin': config['publicOrigin'],
              'autoscaling': {**config['scaling'], 'enabled': True, 'singleNode': True,
                             'prometheusAddress': 'http://prometheus.monitoring.svc.cluster.local:9090'}}
    return [i for i in ha.render(values)['items'] if i['kind'] in [
        'ScaledObject', 'TriggerAuthentication', 'HorizontalPodAutoscaler']]


def monitoring():
    site = SimpleNamespace(namespace=NS, profile={'prometheus_memory': ('64Mi', '256Mi')},
                            versions={'PROMETHEUS_IMAGE': 'prom/prometheus:v3.16.0@sha256:e04987641b57704f408e31f6373ba4138ecf27cb4a165d24aabb6c38fddd0f06'})
    return site_renderer.monitoring_items(site)
