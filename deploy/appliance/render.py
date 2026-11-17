#!/usr/bin/env python3
"""Single-node application topology. Reuses the distributed application's routes and contracts."""
import base64
import hashlib
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
TOPOLOGY_GENERATION = 'single-vm-v2'


def trusted_proxy_networks(config):
    raw = config.get('trustedProxyCidrs', [])
    if not isinstance(raw, list) or len(raw) > 32:
        raise ValueError('trustedProxyCidrs must be an explicit list of at most 32 networks')
    networks = []
    for value in raw:
        if not isinstance(value, str):
            raise ValueError('Proxy networks must be CIDR strings')
        network = ipaddress.ip_network(value, strict=True)
        if network.prefixlen == 0:
            raise ValueError('Trusting every proxy address is not allowed')
        networks.append(str(network))
    for version in [4, 6]:
        combined = ipaddress.collapse_addresses(ipaddress.ip_network(n) for n in networks
                                               if ipaddress.ip_network(n).version == version)
        if any(network.prefixlen == 0 for network in combined):
            raise ValueError('Proxy networks must not collectively trust every address')
    return networks


def front_proxy(config, values):
    key = values['TRUSTED_PROXY_KEY']
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', key):
        raise ValueError('Invalid private ingress credential')
    networks = trusted_proxy_networks(config)
    trusted = ('{\n  servers {\n    trusted_proxies static ' + ' '.join(networks) +
               '\n    trusted_proxies_strict\n  }\n}\n') if networks else ''
    domain = urlparse(config['publicOrigin']).netloc if config.get('tlsMode', 'proxy') == 'automatic' else ':80'
    return trusted + domain + ' {\n  reverse_proxy k3s:30080 {\n' + \
        '    header_up X-Forwarded-For {client_ip}\n' + \
        '    header_up X-Lecturer-Client-IP {client_ip}\n' + \
        '    header_up X-Lecturer-Proxy-Key ' + key + '\n  }\n  encode zstd gzip\n}\n'


def _validate(config, images):
    trusted_proxy_networks(config)
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
    for key, default, low, high in [('podMemoryBudgetMi', 10240, 7000, 262144), ('podCpuBudget', 6, 2, 256), ('clusterMemoryMi', 13312, 8192, 524288), ('platformMemoryMi', 3072, 3072, 131072), ('clusterCpus', 8, 2, 256)]:
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
                               'limits': {'cpu': '2', 'memory': '512Mi'}},
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
    users=[];permissions=[]
    patterns={
      'publisher':(r'^(lecturer\.integration\.v1|lecturer\.analytics\.v1)$',r'^(lecturer\.integration\.v1|lecturer\.analytics\.v1)$',r'^lecturer\.integration\.v1$'),
      'analytics':(r'^(lecturer\.integration\.v1|lecturer\.analytics\.v1)$',r'^lecturer\.analytics\.v1$',r'^(lecturer\.integration\.v1|lecturer\.analytics\.v1)$'),
      'realtime':(r'^(lecturer\.integration\.v1|lecturer\.realtime\.[0-9a-f-]+)$',r'^lecturer\.realtime\.[0-9a-f-]+$',r'^(lecturer\.integration\.v1|lecturer\.realtime\.[0-9a-f-]+)$')}
    for role,(configure,write,read) in patterns.items():
        password=values.get('RABBIT_'+role.upper()+'_PASSWORD',values['RABBITMQ_PASSWORD'])
        salt=hashlib.sha256(('salt:'+password).encode()).digest()[:4]
        users.append({'name':role,'password_hash':base64.b64encode(salt+hashlib.sha256(salt+password.encode()).digest()).decode(),
                      'hashing_algorithm':'rabbit_password_hashing_sha256','tags':[]})
        permissions.append({'user':role,'vhost':'/','configure':configure,'write':write,'read':read})
    items.append(secret('events-definitions',{'definitions.json':json.dumps({'vhosts':[{'name':'/'}],'users':users,'permissions':permissions})}))
    labels = {'app.kubernetes.io/component': 'events'}
    container = {'name': 'rabbitmq', 'ports':[{'name':'metrics','containerPort':15692}], 'image': 'rabbitmq:4.2-alpine@sha256:cd4f5c5bb4ffe530dba84770a8d139b8518470cdd385fec9cf014ebfff6bb009',
                 'env': [{'name': 'RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS', 'value': '+S 2:2 +A 4'}],
                 'resources': {'requests': {'cpu': '100m', 'memory': '192Mi'},
                               'limits': {'cpu': '1', 'memory': '512Mi'}},
                 'readinessProbe': {'exec': {'command': ['rabbitmq-diagnostics', '-q', 'ping']},
                                    'periodSeconds': 10, 'timeoutSeconds': 5},
                 'volumeMounts': [{'name': 'data', 'mountPath': '/var/lib/rabbitmq'},
                                  {'name': 'config', 'mountPath': '/etc/rabbitmq/conf.d/20-site.conf',
                                   'subPath': 'rabbitmq.conf'}, {'name':'config','mountPath':'/etc/rabbitmq/enabled_plugins','subPath':'enabled_plugins'}, {'name':'definitions','mountPath':'/etc/rabbitmq/definitions.json','subPath':'definitions.json'}]}
    items += [secret('events-auth', {'password': values['RABBITMQ_PASSWORD']}),
              obj('ConfigMap', 'events-config', data={'rabbitmq.conf':
                   'vm_memory_high_watermark.absolute = 350MiB\ndisk_free_limit.absolute = 512MB\ndefinitions.import_backend = local_filesystem\ndefinitions.local.path = /etc/rabbitmq/definitions.json\n', 'enabled_plugins':'[rabbitmq_prometheus].\n'}),
              obj('Service', 'events', {'selector': labels, 'ports': [{'port':5672,'name':'amqp'},{'port':15692,'name':'metrics'}]}),
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
                      'containers': [container], 'volumes': [{'name': 'config', 'configMap': {'name': 'events-config'}}, {'name':'definitions','secret':{'secretName':'events-definitions'}}]}},
                  'volumeClaimTemplates': [{'metadata': {'name': 'data'}, 'spec': {
                      'accessModes': ['ReadWriteOnce'], 'storageClassName': 'local-path',
                      'resources': {'requests': {'storage': '5Gi'}}}}]})]
    items.append(obj('PersistentVolumeClaim', 'conversion-scratch', {'accessModes':['ReadWriteOnce'],
                  'storageClassName':'local-path','resources':{'requests':{'storage':'4Gi'}}}))
    site = SimpleNamespace(namespace=NS, versions={'REDIS_IMAGE': 'redis:7.4-alpine@sha256:c5d34a98396a4775e223c74e929162c35c5a2182901ba26b50ade939941ce14b'})
    items += site_renderer.redis_items(site)
    items += [secret('redis-auth', {'password': values['REDIS_PASSWORD']})]
    return items


def secrets(config, values):
    runtime = {k: values[k] for k in site_renderer.RUNTIME_KEYS}
    runtime['CONVERTER_API_KEY'] = values['CONVERTER_API_KEY']
    for role in ['publisher','analytics','realtime']:
        runtime['AMQP_'+role.upper()+'_URL']=f'amqp://{role}:{quote(values.get("RABBIT_"+role.upper()+"_PASSWORD",values["RABBITMQ_PASSWORD"]),safe="")}@events:5672?heartbeat=10'

    runtime.update(ANALYTICS_DATABASE_URL=f'postgres://analytics:{quote(values["ANALYTICS_DB_PASSWORD"], safe="")}@analytics-db-rw:5432/analytics')
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
         'converter': (128, 768, '250m'), 'realtime': (64, 512, '100m'),
         'event-publisher': (48, 192, '50m'), 'analytics': (64, 192, '100m'),
         'media-control': (48, 192, '50m'), 'web': (16, 64, '25m'),
         'edge': (32, 128, '50m'), 'authority': (24, 96, '25m')}


def app(config, images):
    _validate(config, images)
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
                                      'limits': {'cpu': '2', 'memory': f'{limit}Mi', 'ephemeral-storage':'512Mi'}}
            pod = item['spec']['template']['spec']
            if name in ['core','content-worker','edge','web']:
                pod.setdefault('volumes',[]).append({'name':'bounded-temp','emptyDir':{'sizeLimit':'512Mi'}})
                container.setdefault('volumeMounts',[]).append({'name':'bounded-temp','mountPath':'/tmp'})
            if name == 'edge':
                pod.setdefault('volumes',[]).append({'name':'blobs','persistentVolumeClaim':{'claimName':'lecturer-blobs'}})
                container.setdefault('volumeMounts',[]).append({'name':'blobs','mountPath':'/data/blobs','readOnly':True})
            if name == 'core':
                envset(container, {'APP_CONTENT_IMAGE_SENDFILE':'true','MANAGEMENT_EXPOSURE':'health,info,prometheus',
                                   'INSTALLATION_TOPOLOGY_GENERATION':TOPOLOGY_GENERATION})
            if name in ['core', 'content-worker']:
                envset(container, {'JAVA_TOOL_OPTIONS': '-XX:MaxRAMPercentage=60 -XX:ActiveProcessorCount=2 -Xss512k -XX:+ExitOnOutOfMemoryError'})
            if name in ['realtime','event-publisher','analytics']:
                broker_role='publisher' if name=='event-publisher' else name
                container['env']=[e for e in container['env'] if e['name']!='AMQP_URL']
                container['env'].append({'name':'AMQP_URL',**ref('lecturer-runtime','AMQP_'+broker_role.upper()+'_URL')})
            if name in ['realtime', 'event-publisher', 'analytics', 'media-control']:
                envset(container, {'NODE_OPTIONS': f'--max-old-space-size={int(limit * (.5 if name == "realtime" else .55))}'})
            if name == 'authority':
                envset(container, {'GOMEMLIMIT': f'{int(limit * .5)}MiB'})
            if name == 'converter':
                envset(container, {'CONVERTER_MAX_CONVERSIONS':1,'CONVERSION_ROOT':'/data/conversion'})
            if name == 'web':
                pod = item['spec']['template']['spec']
                pod['volumes'].append({'name': 'runtime', 'configMap': {'name': 'public-config'}})
                container['volumeMounts'].append({'name': 'runtime', 'mountPath': '/usr/share/nginx/html/runtime-config.js',
                                                  'subPath': 'runtime-config.js'})
            if name == 'media-control':
                envset(container, {'LIVEKIT_PUBLIC_URL': config['publicOrigin'].replace('https:', 'wss:')})
        if item['kind'] == 'DaemonSet':
            container = item['spec']['template']['spec']['containers'][0]
            envset(container, {'NODE_OPTIONS': '--max-old-space-size=64', 'GOMEMLIMIT': '480MiB'})
            container.setdefault('ports',[]).append({'name':'metrics','containerPort':6789})
            container['resources'] = {'requests': {'cpu': '100m', 'memory': '192Mi'},
                                      'limits': {'cpu': '4', 'memory': '768Mi'}}
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


def monitoring(site_config=None):
    site = SimpleNamespace(namespace=NS, profile={'prometheus_memory': ('64Mi', '256Mi')},
                            versions={'PROMETHEUS_IMAGE': 'prom/prometheus:v3.16.0@sha256:e04987641b57704f408e31f6373ba4138ecf27cb4a165d24aabb6c38fddd0f06'})
    items=site_renderer.monitoring_items(site)
    configMap=next(i for i in items if i['kind']=='ConfigMap')
    config=json.loads(configMap['data']['prometheus.yml'])
    for job,component,port,path in [('core','core',8080,'/actuator/prometheus'),('rabbitmq','events',15692,'/metrics'),('sfu','sfu',6789,'/metrics')]:
        config['scrape_configs'].append({'job_name':job,'metrics_path':path,
          'kubernetes_sd_configs':[{'role':'pod','namespaces':{'names':[NS]}}],
          'relabel_configs':[{'source_labels':['__meta_kubernetes_pod_label_app_kubernetes_io_component'],'regex':component,'action':'keep'},
                            {'source_labels':['__meta_kubernetes_pod_container_port_number'],'regex':str(port),'action':'keep'}]})
    config['scrape_configs'].append({'job_name':'appliance-operations','kubernetes_sd_configs':[{'role':'node'}],
      'relabel_configs':[{'source_labels':['__meta_kubernetes_node_address_InternalIP'],'target_label':'__address__','replacement':'$1:8097'}]})
    alertmanager=(site_config or {}).get('monitoring',{}).get('alertmanagerUrl')
    if alertmanager:
        parsed=urlparse(alertmanager)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ['', '/']:
            raise ValueError('alertmanagerUrl must be an HTTPS origin without credentials')
        config['alerting']={'alertmanagers':[{'scheme':'https','static_configs':[{'targets':[parsed.netloc]}]}]}
    config['rule_files']=['/etc/prometheus/alerts.json']
    configMap['data']['prometheus.yml']=json.dumps(config)
    rules=[('BackupStale','time() - lecturer_backup_last_success_seconds > 93600','10m'),
           ('BackupFailed','lecturer_backup_ok == 0','5m'),('OperationsCollectorFailed','lecturer_operations_collector_up == 0','2m'),
           ('PodPending','lecturer_pods_pending > 0','5m'),('PodOOM','lecturer_pods_oom > 0','1m'),
           ('MemoryBudgetNearFull','lecturer_quota_memory_used_bytes / lecturer_quota_memory_hard_bytes > 0.9','5m'),
           ('DiskReserveLow','lecturer_blob_disk_free_bytes < 3221225472','2m'),('PostgresLockQueue','lecturer_postgres_lock_waiters > 10','2m'),
           ('ImportStalled','lecturer_content_job_oldest_seconds > 900','5m'),('DeadJobs','lecturer_integration_jobs_dead + lecturer_analytics_jobs_dead > 0','5m'),
           ('UpdateNeedsAttention','lecturer_update_needs_attention > 0','1m'),('ScrapeFailed','up == 0','2m'),('HttpFallbackStorm','sum(rate(realtime_http_fallbacks_total[5m])) > 100','5m'),
           ('MaxInboxDead','lecturer_max_inbox_dead_items > 0 or lecturer_max_inbox_dead_blocked > 0','2m'),
           ('MaxInboxBacklog','lecturer_max_inbox_work_items / lecturer_max_inbox_work_limit_items > 0.8 or lecturer_max_inbox_work_bytes / lecturer_max_inbox_work_limit_bytes > 0.8','2m'),
           ('MaxDedupWindowReduced','increase(lecturer_max_inbox_dedup_evictions_total[15m]) > 0','5m')]
    configMap['data']['alerts.json']=json.dumps({'groups':[{'name':'lecturer-operations','rules':[
      {'alert':name,'expr':expr,'for':period,'labels':{'severity':'warning'},'annotations':{'runbook_url':'docs/operations-alerts.md#'+name.lower()}} for name,expr,period in rules]}]})
    items += [{'apiVersion':'rbac.authorization.k8s.io/v1','kind':'ClusterRole','metadata':{'name':'lecturer-monitor-nodes'},
               'rules':[{'apiGroups':[''],'resources':['nodes'],'verbs':['get','list','watch']}]},
              {'apiVersion':'rbac.authorization.k8s.io/v1','kind':'ClusterRoleBinding','metadata':{'name':'lecturer-monitor-nodes'},
               'roleRef':{'apiGroup':'rbac.authorization.k8s.io','kind':'ClusterRole','name':'lecturer-monitor-nodes'},
               'subjects':[{'kind':'ServiceAccount','name':'prometheus','namespace':'monitoring'}]}]
    return items



def resource_budget(config, images):
    """Compute admission from the actual emitted pods, including init containers and one serial surge."""
    items = data(config, {k: 'x'*64 for k in ['PG_SUPERUSER_PASSWORD', 'ANALYTICS_SUPERUSER_PASSWORD',
                  'DB_PASSWORD', 'ANALYTICS_DB_PASSWORD', 'RABBITMQ_PASSWORD', 'REDIS_PASSWORD']}) + app(config, images)
    maximum = minimum = surge = 0
    for item in items:
        if item['kind'] not in ['Deployment', 'StatefulSet', 'DaemonSet']: continue
        pod = item['spec']['template']['spec']
        def memory(c): return site_renderer.mebibytes(c['resources']['limits']['memory'])
        cost = max(sum(memory(c) for c in pod['containers']),
                   max((memory(c) for c in pod.get('initContainers', [])), default=0))
        minimum += cost
        name = item['metadata']['name']
        key = {'core':'coreMax','realtime':'realtimeMax','content-worker':'contentMax',
               'converter':'converterMax','analytics':'analyticsMax'}.get(name)
        maximum += cost * (config['scaling'][key] if key else 1)
        if item['kind']=='Deployment' and item['spec'].get('strategy',{}).get('type')!='Recreate':
            surge = max(surge,cost)
    quota = config.get('podMemoryBudgetMi',10240)
    cluster = config.get('clusterMemoryMi',13312)
    reserve = config.get('platformMemoryMi',3072)
    if maximum + max(surge,32) > quota or quota + reserve > cluster:
        raise ValueError(f'Resource budget needs {maximum} MiB max + {surge} MiB serial update surge; '
                         f'namespace quota {quota} MiB must fit cluster {cluster} MiB minus platform {reserve} MiB')
    return {'minimumMi':minimum,'maximumMi':maximum,'updateSurgeMi':surge,'quotaMi':quota,
            'clusterMi':cluster,'platformMi':reserve}


def validate(config, images):
    _validate(config, images)
    resource_budget(config, images)
