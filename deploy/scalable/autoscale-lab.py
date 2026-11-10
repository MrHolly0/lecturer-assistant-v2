#!/usr/bin/env python3
"""Render a private single-Mac scaling lab, using the existing isolated Compose backbone.

Does not start containers or modify the user's Kubernetes context. Output contains test
credentials and must remain private; use only with lecturer-autoscale.kubeconfig.
"""
import argparse
import importlib.util
import ipaddress
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('scaling', Path(__file__).with_name('ha') / 'autoscaling.py')
scaling = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scaling)
NS = 'lecturer-autoscale'


def render(prometheus_image):
    if '@sha256:' not in prometheus_image:
        raise ValueError('Use the pulled Prometheus image digest')
    settings = {}
    for line in (ROOT / 'deploy/scalable/.env').read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            settings[key] = value.strip().strip('"').strip("'")

    def ip(service):
        name = f'lecturer-scale-lab-{service}-1'
        data = json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
        address = data['NetworkSettings']['Networks']['lecturer-scale-lab_default']['IPAddress']
        ipaddress.ip_address(address)
        return address

    items = [{'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': NS}}]
    secret = {'CORE_URL': f'http://{ip("authority")}:80',
              'SERVICE_REALTIME_KEY': settings['SERVICE_REALTIME_KEY'],
              'AMQP_URL': ','.join(f'amqp://lecturer:{quote(settings["RABBITMQ_PASSWORD"], safe="")}@{ip(s)}:5672?heartbeat=10'
                                   for s in ['rabbit-a', 'rabbit-b', 'rabbit-c'])}
    items.append({'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': 'gateway'}, 'stringData': secret})

    def deployment(name, image, port, replicas=1, env=None, volumes=None, command=None, args=None, account=None):
        labels = {'app.kubernetes.io/component': name}
        container = {'name': name, 'image': image, 'imagePullPolicy': 'IfNotPresent',
                     'ports': [{'name': 'http', 'containerPort': port}],
                     'resources': {'requests': {'cpu': '100m', 'memory': '64Mi'},
                                   'limits': {'cpu': '1', 'memory': '256Mi'}}}
        if env:
            container['env'] = [{'name': key, 'value': str(value)} for key, value in env.items()]
        if command:
            container['command'] = command
        if args:
            container['args'] = args
        pod = {'automountServiceAccountToken': bool(account), 'terminationGracePeriodSeconds': 20,
               'containers': [container], 'topologySpreadConstraints': [{'maxSkew': 1,
                   'topologyKey': 'kubernetes.io/hostname', 'whenUnsatisfiable': 'DoNotSchedule',
                   'labelSelector': {'matchLabels': labels}}]}
        if account:
            pod['serviceAccountName'] = account
        if volumes:
            pod['volumes'] = [{'name': 'config', 'configMap': {'name': name}}]
            container['volumeMounts'] = [{'name': 'config', 'mountPath': volumes, 'readOnly': True}]
        if name == 'realtime':
            container['envFrom'] = [{'secretRef': {'name': 'gateway'}}]
            container['readinessProbe'] = {'httpGet': {'path': '/ready', 'port': port}, 'periodSeconds': 2}
            container['livenessProbe'] = {'httpGet': {'path': '/health', 'port': port}, 'periodSeconds': 10}
        items.append({'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': {'name': name},
                      'spec': {'replicas': replicas, 'selector': {'matchLabels': labels},
                               'template': {'metadata': {'labels': labels}, 'spec': pod}}})
        items.append({'apiVersion': 'v1', 'kind': 'Service', 'metadata': {'name': name},
                      'spec': {'selector': labels, 'ports': [{'port': port, 'targetPort': port}]}})

    deployment('realtime', 'lecturer-assistant/services:autoscale-local', 8091, replicas=2,
               env={'PORT': 8091, 'MAX_CONNECTIONS': 6000, 'DRAIN_WINDOW_MS': 6000,
                    'CORS_ALLOWED_ORIGINS': 'http://127.0.0.1:18091', 'NODE_OPTIONS': '--max-old-space-size=160'},
               command=['node', 'realtime/index.mjs'])
    items += [
        {'apiVersion': 'v1', 'kind': 'ServiceAccount', 'metadata': {'name': 'prometheus'}},
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'Role', 'metadata': {'name': 'prometheus'},
         'rules': [{'apiGroups': [''], 'resources': ['pods'], 'verbs': ['get', 'list', 'watch']}]},
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'RoleBinding', 'metadata': {'name': 'prometheus'},
         'roleRef': {'apiGroup': 'rbac.authorization.k8s.io', 'kind': 'Role', 'name': 'prometheus'},
         'subjects': [{'kind': 'ServiceAccount', 'name': 'prometheus', 'namespace': NS}]},
        {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {'name': 'prometheus'},
         'data': {'prometheus.yml': json.dumps(scaling.prometheus_config(NS, '2s'))}}]
    deployment('prometheus', prometheus_image, 9090, volumes='/etc/prometheus', account='prometheus',
               args=['--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.path=/prometheus',
                     '--storage.tsdb.retention.time=1h', '--storage.tsdb.retention.size=128MB'])
    nginx = '''events { worker_connections 4096; }
http { access_log off; server { listen 8088;
location / { proxy_pass http://realtime:8091; proxy_http_version 1.1;
proxy_set_header Connection ""; proxy_buffering off; proxy_read_timeout 3600s; proxy_connect_timeout 2s;
proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
} }'''
    items.append({'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {'name': 'edge'},
                  'data': {'nginx.conf': nginx}})
    deployment('edge', 'nginx:1.27-alpine', 8088, volumes='/etc/nginx')
    edge = items[-1]['spec']
    edge['type'] = 'NodePort'
    edge['ports'][0]['nodePort'] = 30089
    items.append(scaling.gateway_scaler(NS, f'http://prometheus.{NS}.svc.cluster.local:9090',
                                       minimum=2, maximum=4, target=20, down_seconds=30, polling=5))
    for item in items:
        if item['kind'] != 'Namespace':
            item['metadata']['namespace'] = NS
    return {'apiVersion': 'v1', 'kind': 'List', 'items': items}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prometheus-image', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    data = render(args.prometheus_image)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(data, stream)
    os.chmod(args.output, 0o600)
    print('Private lab manifests written; no default Kubernetes context changed.')
