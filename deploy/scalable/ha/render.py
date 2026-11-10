#!/usr/bin/env python3
"""Render reviewed application manifests; never apply them or read plaintext credentials."""
import argparse
import json
import re
import importlib.util
from pathlib import Path
from urllib.parse import urlparse
_scaling_spec = importlib.util.spec_from_file_location('lecturer_autoscaling', Path(__file__).with_name('autoscaling.py'))
autoscaling = importlib.util.module_from_spec(_scaling_spec)
_scaling_spec.loader.exec_module(autoscaling)


def render(config):
    images = config['images']
    for component in ['core', 'services', 'sfu', 'web', 'authority', 'converter']:
        image = images[component]
        if not re.fullmatch(r'[^\s@]+@sha256:[0-9a-f]{64}', image):
            raise ValueError('Each released image must be pinned by its tested digest: ' + component)
    origin = config['publicOrigin']
    parsed = urlparse(origin)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query \
            or parsed.fragment or parsed.path not in ['', '/']:
        raise ValueError('Production requires a real HTTPS origin')
    namespace = config.get('namespace', 'lecturer')
    items = [{'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': namespace}}]

    def env(values=None, secret_keys=()):
        result = [{'name': k, 'value': str(v)} for k, v in (values or {}).items()]
        result += [{'name': k, 'valueFrom': {'secretKeyRef': {'name': 'lecturer-runtime', 'key': k}}}
                   for k in secret_keys]
        return result

    def db_env(cluster, username_secret=None):
        secret = username_secret or cluster + '-app'
        return [{'name': 'DB_' + key, 'valueFrom': {'secretKeyRef': {'name': secret, 'key': field}}}
                for key, field in [('USERNAME', 'username'), ('PASSWORD', 'password')]]

    def deploy(name, image, count, port, environment, command=None, memory='512Mi', mount=False, probe='/ready'):
        labels = {'app.kubernetes.io/name': 'lecturer', 'app.kubernetes.io/component': name}
        container = {'name': name, 'image': images[image], 'env': environment,
                     'ports': [{'name': 'http', 'containerPort': port}],
                    'resources': {'requests': {'cpu': '250m', 'memory': memory},
                                   'limits': {'cpu': '2', 'memory': memory}},
                     'securityContext': {'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}},
                     'startupProbe': {'httpGet': {'path': probe, 'port': port}, 'periodSeconds': 5, 'failureThreshold': 60},
                     'readinessProbe': {'httpGet': {'path': probe, 'port': port}, 'periodSeconds': 3},
                     'livenessProbe': {'httpGet': {'path': '/health' if probe == '/ready' else probe, 'port': port},
                                       'periodSeconds': 10, 'failureThreshold': 6}}
        if command:
            container['command'] = command
        spec = {'automountServiceAccountToken': False, 'terminationGracePeriodSeconds': 45,
                'containers': [container], 'topologySpreadConstraints': [
                    {'maxSkew': 1, 'topologyKey': 'kubernetes.io/hostname', 'whenUnsatisfiable': 'DoNotSchedule',
                     'labelSelector': {'matchLabels': labels}}]}
        if mount:
            container['volumeMounts'] = [{'name': 'blobs', 'mountPath': '/data/blobs'}]
            spec['volumes'] = [{'name': 'blobs', 'persistentVolumeClaim': {'claimName': 'lecturer-blobs'}}]
        items.append({'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': {'name': name},
                      'spec': {'replicas': count, 'selector': {'matchLabels': labels},
                               'strategy': {'type': 'RollingUpdate', 'rollingUpdate': {'maxUnavailable': 0, 'maxSurge': 1}},
                               'template': {'metadata': {'labels': labels}, 'spec': spec}}})
        items.append({'apiVersion': 'v1', 'kind': 'Service', 'metadata': {'name': name},
                      'spec': {'selector': labels, 'ports': [{'name': 'http', 'port': port, 'targetPort': port}]}})
        if count > 1:
            items.append({'apiVersion': 'policy/v1', 'kind': 'PodDisruptionBudget', 'metadata': {'name': name},
                          'spec': {'minAvailable': count - 1, 'selector': {'matchLabels': labels}}})

    keys = ['JWT_SECRET', 'SLIDE_IMAGE_URL_SECRET', 'CHANNEL_INTERNAL_API_KEY', 'SERVICE_EVENTS_KEY',
            'SERVICE_REALTIME_KEY', 'SERVICE_ANALYTICS_KEY', 'SERVICE_MEDIA_KEY', 'ADMIN_SETUP_TOKEN']
    core_env = env({'DB_URL': 'jdbc:postgresql://app-db-rw:5432/lecturer', 'DB_POOL_MAX_SIZE': 12,
                    'PERMISSION_DB_POOL_SIZE': 4,
                    'DB_POOL_MIN_IDLE': 1, 'BLOB_ROOT': '/data/blobs', 'INTEGRATION_ENABLED': 'true',
                    'CONTENT_WORKER_ENABLED': 'false', 'LEGACY_LIVE_TRANSPORTS_ENABLED': 'false',
                    'MEDIA_PROVIDER': 'sfu', 'MEDIA_SERVICE_URL': 'http://media-control:8093',
                    'ANALYTICS_SERVICE_URL': 'http://analytics:8092', 'APP_CORS_ALLOWED_ORIGINS': origin,
                    'REFRESH_COOKIE_SECURE': 'true', 'REQUIRE_STRONG_JWT_SECRET': 'true',
                    'MANAGEMENT_ENDPOINT_HEALTH_PROBES_ENABLED': 'true',
                    'MANAGEMENT_ENDPOINT_HEALTH_GROUP_READINESS_INCLUDE': 'readinessState,db',
                    'APP_CONTENT_CONVERTER_URL': 'http://converter:8000',
                    'JAVA_TOOL_OPTIONS': '-XX:MaxRAMPercentage=60 -XX:ActiveProcessorCount=2 -Xss512k'}, keys) + db_env('app-db')
    core_env.append({'name': 'MAX_BOT_TOKEN', 'valueFrom': {'secretKeyRef': {
        'name': 'lecturer-runtime', 'key': 'MAX_BOT_TOKEN', 'optional': True}}})
    deploy('core', 'core', 2, 8080, core_env, memory='1Gi', mount=True, probe='/actuator/health')
    deploy('content-worker', 'core', 2, 8080, env({'APP_ROLE': 'content-worker', 'CONTENT_WORKER_ENABLED': 'true',
           'DB_URL': 'jdbc:postgresql://app-db-rw:5432/lecturer', 'SPRING_FLYWAY_ENABLED': 'false',
           'MANAGEMENT_ENDPOINT_HEALTH_PROBES_ENABLED': 'true',
           'MANAGEMENT_ENDPOINT_HEALTH_GROUP_READINESS_INCLUDE': 'readinessState,db',
           'DB_POOL_MAX_SIZE': 4, 'DB_POOL_MIN_IDLE': 0, 'BLOB_ROOT': '/data/blobs',
           'APP_CONTENT_CONVERTER_URL': 'http://converter:8000'}) + db_env('app-db', 'content-worker-db'),
           memory='768Mi', mount=True, probe='/actuator/health')
    deploy('converter', 'converter', 2, 8000, env({'CONVERTER_MAX_CONVERSIONS': 2}),
           memory='1536Mi', mount=True, probe='/health')
    common = {'CORE_URL': 'http://authority:80', 'NODE_OPTIONS': '--max-old-space-size=256'}
    deploy('realtime', 'services', 3, 8091,
           env({**common, 'PORT': 8091, 'MAX_CONNECTIONS': 6000, 'CORS_ALLOWED_ORIGINS': origin,
                'NODE_OPTIONS': '--max-old-space-size=384'},
               ['SERVICE_REALTIME_KEY', 'AMQP_URL']), ['node', 'realtime/index.mjs'], memory='768Mi')
    deploy('event-publisher', 'services', 2, 8094, env({**common, 'PORT': 8094}, ['SERVICE_EVENTS_KEY', 'AMQP_URL']),
           ['node', 'event-publisher/index.mjs'], memory='384Mi')
    deploy('analytics', 'services', 2, 8092, env({**common, 'PORT': 8092},
           ['SERVICE_ANALYTICS_KEY', 'AMQP_URL', 'ANALYTICS_DATABASE_URL']), ['node', 'analytics/index.mjs'])
    deploy('media-control', 'services', 2, 8093,
           env({**common, 'PORT': 8093, 'LIVEKIT_INTERNAL_URL': 'http://sfu:7880',
                'LIVEKIT_PUBLIC_URL': origin.replace('https://', 'wss://')},
               ['SERVICE_MEDIA_KEY', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']), ['node', 'media-control/index.mjs'])
    deploy('web', 'web', 2, 8088, [], memory='128Mi', probe='/')
    # Static web image must use nginx.conf from the scalable profile.
    for item in items:
        if item['kind'] == 'Deployment' and item['metadata']['name'] == 'web':
            pod = item['spec']['template']['spec']
            pod['volumes'] = [{'name': 'nginx', 'configMap': {'name': 'scalable-web'}}]
            pod['containers'][0]['volumeMounts'] = [{'name': 'nginx', 'mountPath': '/etc/nginx/conf.d/default.conf',
                                                   'subPath': 'nginx.conf'},
                                                  {'name': 'nginx', 'mountPath': '/etc/nginx/nginx.conf',
                                                   'subPath': 'nginx-main.conf'}]
            pod['containers'][0]['securityContext'].update({'runAsUser': 101, 'runAsGroup': 101})
    root = Path(__file__).resolve().parents[1]
    resolver = config.get('dnsResolver', 'kube-dns.kube-system.svc.cluster.local')
    if not re.fullmatch(r'[a-zA-Z0-9.:-]+', resolver):
        raise ValueError('Invalid cluster DNS resolver')
    nginx_main = (root / 'nginx-main.conf').read_text().replace('127.0.0.11', resolver)
    items.append({'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {'name': 'scalable-web'},
                  'data': {'nginx.conf': (root / 'nginx.conf').read_text(), 'nginx-main.conf': nginx_main}})
    edge = (root / 'edge.nginx.conf').read_text()
    edge = re.sub(r'    server core-[ab]:8080[^\n]+\n', '', edge)
    edge = edge.replace('upstream application {', 'upstream application {\n    server core:8080 resolve;')
    edge = re.sub(r'    server realtime-[abc]:8091[^\n]+\n', '', edge)
    edge = edge.replace('upstream realtime {', 'upstream realtime {\n    server realtime:8091 resolve max_conns=12000;')
    items.append({'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {'name': 'edge'},
                  'data': {'edge.nginx.conf': edge, 'nginx-main.conf': nginx_main}})
    deploy('edge', 'web', 2, 8088, [], memory='512Mi', probe='/edge-health')
    pod = next(i for i in items if i['kind'] == 'Deployment' and i['metadata']['name'] == 'edge')['spec']['template']['spec']
    pod['volumes'] = [{'name': 'config', 'configMap': {'name': 'edge'}}]
    pod['containers'][0]['securityContext'].update({'runAsUser': 101, 'runAsGroup': 101})
    pod['containers'][0]['volumeMounts'] = [
        {'name': 'config', 'mountPath': '/etc/nginx/conf.d/default.conf', 'subPath': 'edge.nginx.conf'},
        {'name': 'config', 'mountPath': '/etc/nginx/nginx.conf', 'subPath': 'nginx-main.conf'}]
    authority = (root / 'authority.Caddyfile').read_text().replace('core-a:8080 core-b:8080', 'core:8080')
    authority = authority.replace(':80 {', ':80 {\n    handle /edge-health {\n        respond 200\n    }', 1)
    items.append({'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {'name': 'authority'},
                  'data': {'Caddyfile': authority}})
    deploy('authority', 'authority', 2, 80, env({'GOMEMLIMIT': '192MiB'}), memory='256Mi', probe='/edge-health')
    pod = next(i for i in items if i['kind'] == 'Deployment' and i['metadata']['name'] == 'authority')['spec']['template']['spec']
    pod['volumes'] = [{'name': 'config', 'configMap': {'name': 'authority'}}]
    pod['containers'][0]['securityContext']['capabilities']['add'] = ['NET_BIND_SERVICE']
    pod['containers'][0]['volumeMounts'] = [{'name': 'config', 'mountPath': '/etc/caddy/Caddyfile', 'subPath': 'Caddyfile'}]
    labels = {'app.kubernetes.io/name': 'lecturer', 'app.kubernetes.io/component': 'sfu'}
    items += [
        {'apiVersion': 'apps/v1', 'kind': 'DaemonSet', 'metadata': {'name': 'sfu'}, 'spec': {
            'selector': {'matchLabels': labels}, 'updateStrategy': {'type': 'OnDelete'},
            'template': {'metadata': {'labels': labels}, 'spec': {
                'hostNetwork': True, 'dnsPolicy': 'ClusterFirstWithHostNet', 'automountServiceAccountToken': False,
                'nodeSelector': {'lecturer.media': 'true'}, 'terminationGracePeriodSeconds': 1800,
                'containers': [{'name': 'sfu', 'image': images['sfu'],
                    'env': env({'CORE_URL': 'http://authority:80'}, ['SERVICE_MEDIA_KEY', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']),
                    'ports': [{'name': 'access-health', 'containerPort': 8096}],
                    'readinessProbe': {'httpGet': {'path': '/ready', 'port': 8096}, 'periodSeconds': 2},
                    'livenessProbe': {'httpGet': {'path': '/health', 'port': 8096}, 'periodSeconds': 10},
                    'resources': {'requests': {'cpu': '2', 'memory': '2Gi'}, 'limits': {'cpu': '8', 'memory': '4Gi'}},
                    'volumeMounts': [{'name': 'livekit', 'mountPath': '/etc/livekit.yaml', 'subPath': 'livekit.yaml'},
                                     {'name': 'turn', 'mountPath': '/etc/turn', 'readOnly': True}]}],
                'volumes': [{'name': 'livekit', 'secret': {'secretName': 'livekit-config'}},
                            {'name': 'turn', 'secret': {'secretName': 'turn-tls'}}]}}}},
        {'apiVersion': 'v1', 'kind': 'Service', 'metadata': {'name': 'sfu'},
         'spec': {'selector': labels, 'ports': [{'name': 'http', 'port': 7880, 'targetPort': 7880}]}}
    ]
    # Internal authority probes do not call business APIs or expose service RPCs publicly.
    for deployment in (i for i in items if i['kind'] == 'Deployment'
                       and i['metadata']['name'] in ['core', 'content-worker']):
        container = deployment['spec']['template']['spec']['containers'][0]
        container['readinessProbe']['httpGet']['path'] = '/actuator/health/readiness'
        container['livenessProbe']['httpGet']['path'] = '/actuator/health/liveness'
    items.extend(autoscaling.render(config, items))
    for item in items:
        if item['kind'] != 'Namespace':
            item['metadata']['namespace'] = namespace
    return {'apiVersion': 'v1', 'kind': 'List', 'items': items}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('config', type=Path)
    parser.add_argument('--prometheus-config', action='store_true', help='Print the namespaced scrape configuration instead')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    manifests = render(config)
    print(json.dumps(autoscaling.prometheus_config(config.get('namespace', 'lecturer'))
                     if args.prometheus_config else manifests, indent=2))
