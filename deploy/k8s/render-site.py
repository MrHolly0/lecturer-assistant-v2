#!/usr/bin/env python3
"""Manifests for the Kubernetes installation: k3s on Lima VMs (Mac) or on rented Linux servers.

The application itself comes from the reviewed renderer deploy/scalable/ha/render.py, called
unchanged. This file adds what one site needs around it: the data layer, the shared NFS volume
for presentation files, Redis for LiveKit, Prometheus for autoscaling, the MAX adapter, the
in-cluster image registry and the public entry point (tunnel port or TLS ingress).

Two resource profiles:
  full  — the reviewed production sizes: 2-3 replicas per service, autoscaling, three-instance
          PostgreSQL/RabbitMQ with synchronous replication. For Linux servers.
  light — one copy of everything, small reservations, no autoscaling. For a Mac with Lima.

Usage: render-site.py <namespace|platform|data|app|autoscaling|secrets> --site site.env
Prints a Kubernetes List as JSON on stdout. Only `secrets` prints secret values, and the
caller pipes it straight into kubectl.
"""
import argparse
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
HA = ROOT / 'deploy' / 'scalable' / 'ha'

IMAGE_KEYS = ['core', 'services', 'sfu', 'web', 'authority', 'converter', 'max-adapter']
PROMETHEUS_ADDRESS = 'http://prometheus.monitoring.svc.cluster.local:9090'
POSTGRES_IMAGE = 'ghcr.io/cloudnative-pg/postgresql:16'

# Sizes per profile. `full` follows deploy/scalable/ha/data.yaml and autoscaling.example.json.
PROFILES = {
    'full': {
        'memory_ratio': 1.0, 'cpu_request': None, 'single_replicas': False,
        'app_db': {'connections': 180, 'storage': '100Gi', 'shared_buffers': '1GB',
                   'requests': {'cpu': '2', 'memory': '4Gi'}, 'limits': {'cpu': '4', 'memory': '8Gi'}},
        'analytics_db': {'connections': 60, 'storage': '50Gi', 'shared_buffers': '256MB',
                         'requests': {'cpu': '1', 'memory': '1Gi'}, 'limits': {'cpu': '2', 'memory': '2Gi'}},
        'rabbit': {'storage': '20Gi', 'requests': {'cpu': '1', 'memory': '512Mi'},
                   'limits': {'cpu': '2', 'memory': '1Gi'}, 'disk_free': '2GB'},
        'sfu': None,
        'scaling': {'coreMax': 6, 'realtimeMax': 6, 'contentMax': 4, 'converterMax': 4, 'analyticsMax': 4},
        'registry_storage': '30Gi', 'prometheus_memory': ('256Mi', '768Mi'),
    },
    'light': {
        'memory_ratio': 0.25, 'cpu_request': '50m', 'single_replicas': True,
        'app_db': {'connections': 100, 'storage': '10Gi', 'shared_buffers': '128MB',
                   'requests': {'cpu': '100m', 'memory': '384Mi'}, 'limits': {'cpu': '1', 'memory': '1Gi'}},
        'analytics_db': {'connections': 60, 'storage': '5Gi', 'shared_buffers': '64MB',
                         'requests': {'cpu': '50m', 'memory': '128Mi'}, 'limits': {'cpu': '500m', 'memory': '512Mi'}},
        'rabbit': {'storage': '3Gi', 'requests': {'cpu': '100m', 'memory': '320Mi'},
                   'limits': {'cpu': '1', 'memory': '768Mi'}, 'disk_free': '1GB'},
        'sfu': {'requests': {'cpu': '100m', 'memory': '256Mi'}, 'limits': {'cpu': '2', 'memory': '1Gi'}},
        'scaling': None,
        'registry_storage': '15Gi', 'prometheus_memory': None,
    },
}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


renderer = load_module('lecturer_render', HA / 'render.py')
autoscaling = renderer.autoscaling


def read_env(path):
    values = {}
    if path and Path(path).exists():
        for line in Path(path).read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            values[key.strip()] = value.strip().strip('"\'')
    return values


class Site:
    def __init__(self, env, versions):
        self.env = env
        self.versions = versions
        domain = env.get('PUBLIC_DOMAIN', '')
        if not re.fullmatch(r'[a-z0-9]([a-z0-9.-]*[a-z0-9])?', domain or '-'):
            raise ValueError('PUBLIC_DOMAIN must be a bare host name, e.g. lecturer-assistant.ru.tuna.am')
        self.domain = domain
        self.origin = 'https://' + domain
        self.namespace = 'lecturer'
        self.platform = self.choice('PLATFORM', 'lima', ['lima', 'linux'])
        self.profile_name = self.choice('PROFILE', 'light' if self.platform == 'lima' else 'full', list(PROFILES))
        self.profile = PROFILES[self.profile_name]
        self.public_mode = self.choice('PUBLIC_MODE', 'tunnel' if self.platform == 'lima' else 'ingress',
                                       ['tunnel', 'ingress'])
        self.acme_email = env.get('ACME_EMAIL', '')
        if self.public_mode == 'ingress' and '@' not in self.acme_email:
            raise ValueError('PUBLIC_MODE=ingress needs ACME_EMAIL for Let\'s Encrypt')
        self.cluster = env.get('CLUSTER_NAME', 'lecturer-k8s')
        self.nodes = self.integer('NODE_COUNT', 1 if self.platform == 'lima' else 3, 1, 20)
        self.edge_port = self.integer('EDGE_PORT', 18088, 1024, 65535)
        self.ratio = float(env.get('MEMORY_REQUEST_RATIO') or self.profile['memory_ratio'])
        if not 0.1 <= self.ratio <= 1:
            raise ValueError('MEMORY_REQUEST_RATIO must be between 0.1 and 1')
        # Autoscaling needs several replicas; the light profile keeps one copy of everything.
        self.autoscaling = env.get('AUTOSCALING', 'true') == 'true' and self.profile['scaling'] is not None
        self.register_webhook = env.get('MAX_REGISTER_WEBHOOK_ON_START', 'true')
        self.media_ip = env.get('MEDIA_PUBLIC_IP', '')
        if self.media_ip and not re.fullmatch(r'\d{1,3}(\.\d{1,3}){3}', self.media_ip):
            raise ValueError('MEDIA_PUBLIC_IP must be an IPv4 address')
        self.server_node = env.get('SERVER_NODE') or f'lima-{self.cluster}-1'
        self.server_ip = env.get('SERVER_IP', '')
        self.nfs_server = env.get('NFS_SERVER') or (self.server_ip if self.platform == 'linux'
                                                    else f'{self.server_node}.internal')
        self.data_replicas = 1 if self.profile['single_replicas'] else min(3, self.nodes)

    def integer(self, key, default, low, high):
        value = int(self.env.get(key) or default)
        if not low <= value <= high:
            raise ValueError(f'{key} must be between {low} and {high}')
        return value

    def choice(self, key, default, allowed):
        value = self.env.get(key) or default
        if value not in allowed:
            raise ValueError(f'{key} must be one of: ' + ', '.join(allowed))
        return value


def lst(items):
    return {'apiVersion': 'v1', 'kind': 'List', 'items': items}


def meta(name, namespace=None, **extra):
    result = {'name': name, **extra}
    if namespace:
        result['namespace'] = namespace
    return result


def mebibytes(quantity):
    match = re.fullmatch(r'(\d+)(Mi|Gi)', quantity)
    if not match:
        raise ValueError('Unsupported memory quantity ' + quantity)
    return int(match.group(1)) * (1024 if match.group(2) == 'Gi' else 1)


def labels(component):
    return {'app.kubernetes.io/name': 'lecturer', 'app.kubernetes.io/component': component}


def secure_container(container):
    container['securityContext'] = {'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}}
    return container


def deployment(name, namespace, container, replicas=1, strategy=None, volumes=None, component=None):
    selector = labels(component or name)
    spec = {'automountServiceAccountToken': False, 'containers': [container]}
    if volumes:
        spec['volumes'] = volumes
    return {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': meta(name, namespace),
            'spec': {'replicas': replicas, 'selector': {'matchLabels': selector},
                     'strategy': strategy or {'type': 'RollingUpdate'},
                     'template': {'metadata': {'labels': selector}, 'spec': spec}}}


def service(name, namespace, port, component=None, service_type=None, service_port=None):
    spec = {'selector': labels(component or name),
            'ports': [{'name': 'http', 'port': service_port or port, 'targetPort': port}]}
    if service_type:
        spec['type'] = service_type
    return {'apiVersion': 'v1', 'kind': 'Service', 'metadata': meta(name, namespace), 'spec': spec}


# --- namespace ---------------------------------------------------------------------------

def namespace_items(site):
    return [{'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': site.namespace}}]


# --- platform: registry and Prometheus ----------------------------------------------------

def platform_items(site):
    registry_labels = {'app': 'registry'}
    container = secure_container({
        'name': 'registry', 'image': site.versions['REGISTRY_IMAGE'],
        'env': [{'name': 'REGISTRY_STORAGE_DELETE_ENABLED', 'value': 'true'}],
        'ports': [{'containerPort': 5000}],
        'readinessProbe': {'httpGet': {'path': '/v2/', 'port': 5000}, 'periodSeconds': 5},
        'resources': {'requests': {'cpu': '50m', 'memory': '64Mi'}, 'limits': {'memory': '256Mi'}},
        'volumeMounts': [{'name': 'data', 'mountPath': '/var/lib/registry'}]})
    if site.platform == 'linux':
        # The registry has no authentication: on servers it listens only on the private address.
        container['ports'][0].update(hostPort=5000, hostIP=site.server_ip)
        registry_service = {'apiVersion': 'v1', 'kind': 'Service', 'metadata': meta('registry', 'registry'),
                            'spec': {'selector': registry_labels, 'ports': [{'port': 5000, 'targetPort': 5000}]}}
    else:
        registry_service = {'apiVersion': 'v1', 'kind': 'Service', 'metadata': meta('registry', 'registry'),
                            'spec': {'type': 'NodePort', 'selector': registry_labels,
                                     'ports': [{'port': 5000, 'targetPort': 5000, 'nodePort': 30500}]}}
    items = [
        {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': 'registry'}},
        {'apiVersion': 'v1', 'kind': 'PersistentVolumeClaim', 'metadata': meta('registry', 'registry'),
         'spec': {'accessModes': ['ReadWriteOnce'], 'storageClassName': 'local-path',
                  'resources': {'requests': {'storage': site.profile['registry_storage']}}}},
        {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': meta('registry', 'registry'),
         'spec': {'replicas': 1, 'strategy': {'type': 'Recreate'}, 'selector': {'matchLabels': registry_labels},
                  'template': {'metadata': {'labels': registry_labels}, 'spec': {
                      'automountServiceAccountToken': False,
                      # The volume is local to one node; keep the registry next to it.
                      'nodeSelector': {'kubernetes.io/hostname': site.server_node},
                      'containers': [container],
                      'volumes': [{'name': 'data', 'persistentVolumeClaim': {'claimName': 'registry'}}]}}}},
        registry_service,
    ]
    if site.autoscaling:
        items += monitoring_items(site)
    return items


def monitoring_items(site):
    config = autoscaling.prometheus_config(site.namespace)
    prom_labels = {'app': 'prometheus'}
    request, limit = site.profile['prometheus_memory']
    return [
        {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': 'monitoring'}},
        {'apiVersion': 'v1', 'kind': 'ServiceAccount', 'metadata': meta('prometheus', 'monitoring')},
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'Role',
         'metadata': meta('prometheus-discovery', site.namespace),
         'rules': [{'apiGroups': [''], 'resources': ['pods'], 'verbs': ['get', 'list', 'watch']}]},
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'RoleBinding',
         'metadata': meta('prometheus-discovery', site.namespace),
         'roleRef': {'apiGroup': 'rbac.authorization.k8s.io', 'kind': 'Role', 'name': 'prometheus-discovery'},
         'subjects': [{'kind': 'ServiceAccount', 'name': 'prometheus', 'namespace': 'monitoring'}]},
        {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': meta('prometheus', 'monitoring'),
         'data': {'prometheus.yml': json.dumps(config, indent=2)}},
        {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': meta('prometheus', 'monitoring'),
         'spec': {'replicas': 1, 'strategy': {'type': 'Recreate'}, 'selector': {'matchLabels': prom_labels},
                  'template': {'metadata': {'labels': prom_labels}, 'spec': {
                      'serviceAccountName': 'prometheus',
                      'securityContext': {'runAsUser': 65534, 'runAsNonRoot': True, 'fsGroup': 65534},
                      'containers': [secure_container({
                          'name': 'prometheus', 'image': site.versions['PROMETHEUS_IMAGE'],
                          'args': ['--config.file=/etc/prometheus/prometheus.yml',
                                   '--storage.tsdb.path=/prometheus', '--storage.tsdb.retention.time=2d'],
                          'ports': [{'containerPort': 9090}],
                          'readinessProbe': {'httpGet': {'path': '/-/ready', 'port': 9090}, 'periodSeconds': 5},
                          'resources': {'requests': {'cpu': '100m', 'memory': request},
                                        'limits': {'memory': limit}},
                          'volumeMounts': [{'name': 'config', 'mountPath': '/etc/prometheus'},
                                           {'name': 'data', 'mountPath': '/prometheus'}]})],
                      'volumes': [{'name': 'config', 'configMap': {'name': 'prometheus'}},
                                  {'name': 'data', 'emptyDir': {'sizeLimit': '2Gi'}}]}}}},
        {'apiVersion': 'v1', 'kind': 'Service', 'metadata': meta('prometheus', 'monitoring'),
         'spec': {'selector': prom_labels, 'ports': [{'port': 9090, 'targetPort': 9090}]}},
    ]


# --- data: PostgreSQL (CloudNativePG) and RabbitMQ ------------------------------------------
# Same settings as deploy/scalable/ha/data.yaml, sized by profile. Synchronous replication
# needs at least three instances; with fewer it would block every write.

def postgres_cluster(site, name, database, owner, roles, sizes, extra=None):
    replicas = site.data_replicas
    postgresql = {'parameters': {'max_connections': str(sizes['connections']),
                                 'shared_buffers': sizes['shared_buffers'], **(extra or {})}}
    if replicas >= 3:
        postgresql['synchronous'] = {'method': 'any', 'number': 1, 'dataDurability': 'required',
                                     'failoverQuorum': True}
    return {'apiVersion': 'postgresql.cnpg.io/v1', 'kind': 'Cluster', 'metadata': meta(name, site.namespace),
            'spec': {'instances': replicas, 'imageName': POSTGRES_IMAGE, 'enableSuperuserAccess': False,
                     'bootstrap': {'initdb': {'database': database, 'owner': owner}},
                     'managed': {'roles': [{'name': role, 'ensure': 'present', 'login': True,
                                            'passwordSecret': {'name': secret}} for role, secret in roles]},
                     'postgresql': postgresql,
                     'affinity': {'enablePodAntiAffinity': True, 'podAntiAffinityType': 'required',
                                  'topologyKey': 'kubernetes.io/hostname'},
                     'storage': {'size': sizes['storage']},
                     'resources': {'requests': sizes['requests'], 'limits': sizes['limits']}}}


def data_items(site):
    replicas = site.data_replicas
    profile = site.profile
    app_db = postgres_cluster(
        site, 'app-db', 'lecturer', 'lecturer',
        [('content_worker', 'content-worker-db'), ('content_scaler', 'content-scaler-db')], profile['app_db'],
        {'work_mem': '4MB', 'statement_timeout': '30s', 'idle_in_transaction_session_timeout': '60s'})
    analytics_db = postgres_cluster(
        site, 'analytics-db', 'analytics', 'analytics', [('analytics_scaler', 'analytics-scaler-db')],
        profile['analytics_db'])
    rabbit_sizes = profile['rabbit']
    rabbit = {'apiVersion': 'rabbitmq.com/v1beta1', 'kind': 'RabbitmqCluster',
              'metadata': meta('events', site.namespace),
              'spec': {'replicas': replicas, 'image': site.versions['RABBITMQ_IMAGE'],
                       'persistence': {'storage': rabbit_sizes['storage']},
                       'resources': {'requests': rabbit_sizes['requests'], 'limits': rabbit_sizes['limits']},
                       'affinity': {'podAntiAffinity': {'requiredDuringSchedulingIgnoredDuringExecution': [
                           {'labelSelector': {'matchLabels': {'app.kubernetes.io/name': 'events'}},
                            'topologyKey': 'kubernetes.io/hostname'}]}},
                       'rabbitmq': {'additionalConfig': '\n'.join([
                           'cluster_partition_handling = pause_minority',
                           'queue_leader_locator = balanced',
                           'quorum_queue.continuous_membership_reconciliation.enabled = true',
                           f'quorum_queue.continuous_membership_reconciliation.target_group_size = {replicas}',
                           'quorum_queue.continuous_membership_reconciliation.interval = 10000',
                           f'disk_free_limit.absolute = {rabbit_sizes["disk_free"]}',
                           'vm_memory_high_watermark.relative = 0.6'])}}}
    return [app_db, analytics_db, rabbit]


# --- application -------------------------------------------------------------------------

def release_config(site, images):
    missing = [key for key in IMAGE_KEYS if key not in images]
    if missing:
        raise ValueError('Images not built yet: ' + ', '.join(missing) + '. Run: lecturer-k8s.sh build')
    config = {'publicOrigin': site.origin, 'namespace': site.namespace,
              'images': {key: images[key] for key in IMAGE_KEYS if key != 'max-adapter'}}
    if site.autoscaling:
        config['autoscaling'] = {
            'enabled': True, 'prometheusAddress': PROMETHEUS_ADDRESS, **site.profile['scaling'],
            'databaseConnections': site.profile['app_db']['connections'], 'reservedConnections': 30,
            'analyticsDatabaseConnections': site.profile['analytics_db']['connections'],
            'analyticsReservedConnections': 20}
    return config


AUTOSCALING_KINDS = {'ScaledObject', 'TriggerAuthentication', 'HorizontalPodAutoscaler'}


def rendered(site, images):
    return renderer.render(release_config(site, images))['items']


def app_items(site, images):
    profile = site.profile
    items = [item for item in rendered(site, images)
             if item['kind'] not in AUTOSCALING_KINDS and item['kind'] != 'Namespace']
    if profile['single_replicas']:
        # One copy per service: a disruption budget would forbid every voluntary restart.
        items = [item for item in items if item['kind'] != 'PodDisruptionBudget']
    for item in items:
        if item['kind'] == 'Deployment':
            if profile['single_replicas']:
                item['spec']['replicas'] = 1
            resources = item['spec']['template']['spec']['containers'][0]['resources']
            limit = mebibytes(resources['limits']['memory'])
            # Requests are what the scheduler reserves; limits stay as reviewed.
            if site.ratio < 1:
                resources['requests']['memory'] = f'{max(64, int(limit * site.ratio))}Mi'
            if profile['cpu_request']:
                resources['requests']['cpu'] = profile['cpu_request']
        if item['kind'] == 'DaemonSet' and item['metadata']['name'] == 'sfu' and profile['sfu']:
            item['spec']['template']['spec']['containers'][0]['resources'] = json.loads(json.dumps(profile['sfu']))
    ns = site.namespace
    items += [
        # Presentation files shared by core, content workers and converters (ReadWriteMany).
        {'apiVersion': 'v1', 'kind': 'PersistentVolume', 'metadata': {'name': f'{ns}-blobs'},
         'spec': {'capacity': {'storage': '50Gi'}, 'accessModes': ['ReadWriteMany'],
                  'persistentVolumeReclaimPolicy': 'Retain', 'storageClassName': '',
                  'mountOptions': ['nfsvers=4.2', 'hard'],
                  'claimRef': {'namespace': ns, 'name': 'lecturer-blobs'},
                  'nfs': {'server': site.nfs_server, 'path': '/srv/nfs/lecturer-blobs'}}},
        {'apiVersion': 'v1', 'kind': 'PersistentVolumeClaim', 'metadata': meta('lecturer-blobs', ns),
         'spec': {'accessModes': ['ReadWriteMany'], 'storageClassName': '', 'volumeName': f'{ns}-blobs',
                  'resources': {'requests': {'storage': '50Gi'}}}},
    ]
    items += public_items(site) + redis_items(site) + max_adapter_items(site, images)
    return items


def public_items(site):
    ns = site.namespace
    if site.public_mode == 'tunnel':
        # Plain HTTP on EDGE_PORT of the node that carries the load balancer; the tunnel adds TLS.
        return [{'apiVersion': 'v1', 'kind': 'Service', 'metadata': meta('edge-public', ns),
                 'spec': {'type': 'LoadBalancer', 'selector': labels('edge'),
                          'ports': [{'name': 'http', 'port': site.edge_port, 'targetPort': 8088}]}}]
    # Traefik (bundled with k3s) on 80/443, certificate from Let's Encrypt via cert-manager.
    return [
        {'apiVersion': 'cert-manager.io/v1', 'kind': 'ClusterIssuer', 'metadata': {'name': 'letsencrypt'},
         'spec': {'acme': {'server': 'https://acme-v02.api.letsencrypt.org/directory', 'email': site.acme_email,
                           'privateKeySecretRef': {'name': 'letsencrypt-account'},
                           'solvers': [{'http01': {'ingress': {'ingressClassName': 'traefik'}}}]}}},
        {'apiVersion': 'traefik.io/v1alpha1', 'kind': 'Middleware', 'metadata': meta('https-redirect', ns),
         'spec': {'redirectScheme': {'scheme': 'https', 'permanent': True}}},
        {'apiVersion': 'networking.k8s.io/v1', 'kind': 'Ingress', 'metadata': meta('edge', ns, annotations={
            'cert-manager.io/cluster-issuer': 'letsencrypt',
            'traefik.ingress.kubernetes.io/router.middlewares': f'{ns}-https-redirect@kubernetescrd'}),
         'spec': {'ingressClassName': 'traefik',
                  'tls': [{'hosts': [site.domain], 'secretName': 'edge-tls'}],
                  'rules': [{'host': site.domain, 'http': {'paths': [
                      {'path': '/', 'pathType': 'Prefix',
                       'backend': {'service': {'name': 'edge', 'port': {'number': 8088}}}}]}}]}},
    ]


def redis_items(site):
    container = secure_container({
        'name': 'redis', 'image': site.versions['REDIS_IMAGE'],
        'args': ['--requirepass', '$(REDIS_PASSWORD)', '--maxmemory', '96mb', '--maxmemory-policy', 'noeviction',
                 '--save', '', '--appendonly', 'no'],
        'env': [{'name': 'REDIS_PASSWORD', 'valueFrom': {'secretKeyRef': {'name': 'redis-auth', 'key': 'password'}}}],
        'ports': [{'name': 'redis', 'containerPort': 6379}],
        'readinessProbe': {'tcpSocket': {'port': 6379}, 'periodSeconds': 5},
        'resources': {'requests': {'cpu': '50m', 'memory': '64Mi'}, 'limits': {'memory': '160Mi'}}})
    container['securityContext'].update({'runAsUser': 999, 'runAsNonRoot': True})
    svc = service('redis', site.namespace, 6379)
    svc['spec']['ports'][0]['name'] = 'redis'
    return [deployment('redis', site.namespace, container, strategy={'type': 'Recreate'}), svc]


def max_adapter_items(site, images):
    secret = lambda key, optional=False: {'secretKeyRef': {'name': 'lecturer-runtime', 'key': key,
                                                             **({'optional': True} if optional else {})}}
    container = secure_container({
        'name': 'max-adapter', 'image': images['max-adapter'],
        'env': [
            {'name': 'CORE_URL', 'value': 'http://authority:80'},
            {'name': 'PUBLIC_ORIGIN', 'value': site.origin},
            {'name': 'MAX_WEBAPP_URL', 'value': site.origin + '/'},
            {'name': 'MAX_WEBHOOK_PATH', 'valueFrom': secret('MAX_WEBHOOK_PATH')},
            {'name': 'MAX_WEBHOOK_URL', 'value': '$(PUBLIC_ORIGIN)$(MAX_WEBHOOK_PATH)'},
            {'name': 'MAX_WEBHOOK_SECRET', 'valueFrom': secret('MAX_WEBHOOK_SECRET')},
            {'name': 'MAX_WEBHOOK_PORT', 'value': '8090'},
            {'name': 'MAX_REGISTER_WEBHOOK_ON_START', 'value': site.register_webhook},
            {'name': 'MAX_RATE_LIMIT_RPS', 'value': '15'},
            {'name': 'NODE_OPTIONS', 'value': '--max-old-space-size=128'},
            {'name': 'CHANNEL_INTERNAL_API_KEY', 'valueFrom': secret('CHANNEL_INTERNAL_API_KEY')},
            {'name': 'MAX_BOT_TOKEN', 'valueFrom': secret('MAX_BOT_TOKEN', optional=True)}],
        'ports': [{'name': 'http', 'containerPort': 8090}],
        'resources': {'requests': {'cpu': '50m', 'memory': '128Mi'}, 'limits': {'cpu': '500m', 'memory': '256Mi'}}})
    # One poller/webhook owner per bot token: never two copies at once.
    return [deployment('max-adapter', site.namespace, container, strategy={'type': 'Recreate'}),
            service('max-adapter', site.namespace, 8090)]


def autoscaling_items(site, images):
    if not site.autoscaling:
        return []
    return [item for item in rendered(site, images) if item['kind'] in AUTOSCALING_KINDS]


# --- secrets -------------------------------------------------------------------------------

RUNTIME_KEYS = ['JWT_SECRET', 'SLIDE_IMAGE_URL_SECRET', 'CHANNEL_INTERNAL_API_KEY', 'SERVICE_EVENTS_KEY',
                'SERVICE_REALTIME_KEY', 'SERVICE_ANALYTICS_KEY', 'SERVICE_MEDIA_KEY', 'ADMIN_SETUP_TOKEN',
                'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'MAX_WEBHOOK_SECRET', 'MAX_WEBHOOK_PATH']


def secret(name, namespace, data, secret_type='Opaque'):
    return {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': meta(name, namespace), 'type': secret_type,
            'stringData': data}


def livekit_config(site, values):
    redis_host = f'redis.{site.namespace}.svc.cluster.local:6379'
    # The media node announces its public address explicitly. Automatic STUN discovery
    # (use_external_ip) can stall LiveKit start-up for minutes behind NAT, so it stays off.
    # Without MEDIA_PUBLIC_IP (a Mac) the media ports stay inside the node network.
    rtc = ['rtc:', '  tcp_port: 7881', '  udp_port: 7882', '  use_external_ip: false']
    if site.media_ip:
        rtc.append(f'  node_ip: {site.media_ip}')
    return '\n'.join([
        'port: 7880', 'bind_addresses: ["0.0.0.0"]', *rtc,
        'redis:', f'  address: {redis_host}', f'  password: "{values["REDIS_PASSWORD"]}"',
        'keys:', f'  {values["LIVEKIT_API_KEY"]}: {values["LIVEKIT_API_SECRET"]}',
        'room:', '  max_participants: 1500', '  empty_timeout: 60', '  departure_timeout: 10',
        'turn:', '  enabled: false', 'logging:', '  level: warn', ''])


def secret_items(site, values, stage, state_dir):
    ns = site.namespace
    required = RUNTIME_KEYS + ['REDIS_PASSWORD', 'CONTENT_DB_PASSWORD', 'CONTENT_SCALER_PASSWORD',
                               'ANALYTICS_SCALER_PASSWORD']
    missing = [key for key in required if key not in values]
    if missing:
        raise ValueError('secrets.env is missing ' + ', '.join(missing) + '. Run: lecturer-k8s.sh init')
    if len(values['LIVEKIT_API_KEY']) < 32:
        raise ValueError('LIVEKIT_API_KEY must have at least 32 characters')
    basic = 'kubernetes.io/basic-auth'
    items = [
        secret('content-worker-db', ns, {'username': 'content_worker', 'password': values['CONTENT_DB_PASSWORD']}, basic),
        secret('content-scaler-db', ns, {'username': 'content_scaler', 'password': values['CONTENT_SCALER_PASSWORD']}, basic),
        secret('analytics-scaler-db', ns,
               {'username': 'analytics_scaler', 'password': values['ANALYTICS_SCALER_PASSWORD']}, basic),
        secret('redis-auth', ns, {'password': values['REDIS_PASSWORD']}),
        secret('lecturer-scaling-content', ns, {'connection':
            f'postgresql://content_scaler:{quote(values["CONTENT_SCALER_PASSWORD"], safe="")}'
            f'@app-db-rw.{ns}.svc:5432/lecturer?sslmode=require'}),
        secret('lecturer-scaling-analytics', ns, {'connection':
            f'postgresql://analytics_scaler:{quote(values["ANALYTICS_SCALER_PASSWORD"], safe="")}'
            f'@analytics-db-rw.{ns}.svc:5432/analytics?sslmode=require'}),
        secret('livekit-config', ns, {'livekit.yaml': livekit_config(site, values)}),
    ]
    certificate = Path(state_dir) / 'turn.crt'
    key = Path(state_dir) / 'turn.key'
    if certificate.exists() and key.exists():
        items.append(secret('turn-tls', ns, {'tls.crt': certificate.read_text(), 'tls.key': key.read_text()},
                            'kubernetes.io/tls'))
    if stage == 'runtime':
        for key_name in ['RABBITMQ_USERNAME', 'RABBITMQ_PASSWORD', 'ANALYTICS_DB_PASSWORD']:
            if not os.environ.get(key_name):
                raise ValueError(key_name + ' must be passed from the cluster')
        amqp = (f'amqp://{quote(os.environ["RABBITMQ_USERNAME"], safe="")}:'
                f'{quote(os.environ["RABBITMQ_PASSWORD"], safe="")}@events.{ns}.svc:5672?heartbeat=10')
        analytics = (f'postgres://analytics:{quote(os.environ["ANALYTICS_DB_PASSWORD"], safe="")}'
                     f'@analytics-db-rw.{ns}.svc:5432/analytics')
        runtime = {key_name: values[key_name] for key_name in RUNTIME_KEYS}
        runtime.update(AMQP_URL=amqp, ANALYTICS_DATABASE_URL=analytics)
        if values.get('MAX_BOT_TOKEN'):
            runtime['MAX_BOT_TOKEN'] = values['MAX_BOT_TOKEN']
        items.append(secret('lecturer-runtime', ns, runtime))
    return items


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('what', choices=['namespace', 'platform', 'data', 'app', 'autoscaling', 'secrets', 'show'])
    parser.add_argument('--site', required=True, type=Path)
    parser.add_argument('--images', type=Path)
    parser.add_argument('--secrets', type=Path)
    parser.add_argument('--stage', choices=['base', 'runtime'], default='base')
    args = parser.parse_args(argv)
    site = Site(read_env(args.site), read_env(HERE / 'versions.env'))
    if args.what == 'show':
        # Resolved settings for the shell script: platform, profile, public mode, autoscaling.
        print(f'{site.platform} {site.profile_name} {site.public_mode} {str(site.autoscaling).lower()}')
        return
    images = json.loads(args.images.read_text()) if args.images and args.images.exists() else {}
    if args.what == 'namespace':
        items = namespace_items(site)
    elif args.what == 'platform':
        items = platform_items(site)
    elif args.what == 'data':
        items = data_items(site)
    elif args.what == 'app':
        items = app_items(site, images)
    elif args.what == 'autoscaling':
        items = autoscaling_items(site, images)
    else:
        items = secret_items(site, read_env(args.secrets), args.stage, args.site.parent)
    json.dump(lst(items), sys.stdout, indent=1)
    sys.stdout.write('\n')


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print('render-site: ' + str(error), file=sys.stderr)
        sys.exit(2)
