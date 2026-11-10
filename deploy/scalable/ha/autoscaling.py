"""Bounded HPA/KEDA policies. The operator and database credentials are installed separately."""
from urllib.parse import urlparse
import re


# Installation-wide ceilings divided into fixed local allotments. Include one update surge.
# These are safety budgets, not a shared distributed sliding-window counter.
RATE_BUDGETS = {
    'reads': ('API_READS_PER_MINUTE', 7200),
    'writes': ('API_WRITES_PER_MINUTE', 1440),
    'analytics': ('API_ANALYTICS_PER_MINUTE', 360),
    'anonymous': ('API_ANONYMOUS_PER_MINUTE', 72000),
    'images': ('API_IMAGE_REQUESTS_PER_MINUTE', 720000),
    'auth': ('RATE_LIMIT_AUTH_MAX_PER_MINUTE', 18000),
    'signals': ('RATE_LIMIT_SIGNAL_PER_MINUTE', 36000),
    'credentialLookups': ('API_CREDENTIAL_LOOKUPS_PER_MINUTE', 720000),
    'concurrentLookups': ('API_CREDENTIAL_LOOKUP_CONCURRENT', 24),
    'concurrentRequests': ('API_CONCURRENT_REQUESTS', 768),
    'concurrentAnalytics': ('API_CONCURRENT_ANALYTICS', 48)}


def local_budgets(settings, maximum):
    configured = settings.get('rateBudgets', {})
    slots = maximum + 1
    if not isinstance(configured, dict) or set(configured) - RATE_BUDGETS.keys():
        raise ValueError('Unknown rate budget')
    result = {}
    for key, (variable, default) in RATE_BUDGETS.items():
        value = configured.get(key, default)
        if type(value) is not int or value < slots:
            raise ValueError('Rate budget must provide at least one permit per maximum/surge replica: ' + key)
        result[variable] = value // slots
    return result


def behavior(down_seconds=300):
    return {
        'scaleUp': {'stabilizationWindowSeconds': 0, 'selectPolicy': 'Min',
                    'policies': [{'type': 'Pods', 'value': 2, 'periodSeconds': 30}]},
        'scaleDown': {'stabilizationWindowSeconds': down_seconds, 'selectPolicy': 'Min',
                      'policies': [{'type': 'Pods', 'value': 1, 'periodSeconds': 60}]}}


def scaled_object(namespace, name, trigger, minimum, maximum, down_seconds=300, polling=15):
    if not 1 <= minimum <= maximum <= 16 or not 0 <= down_seconds <= 3600 or not 1 <= polling <= 60:
        raise ValueError('Invalid scaling limits')
    return {'apiVersion': 'keda.sh/v1alpha1', 'kind': 'ScaledObject',
            'metadata': {'name': name, 'namespace': namespace},
            'spec': {'scaleTargetRef': {'name': name}, 'minReplicaCount': minimum, 'maxReplicaCount': maximum,
                     'pollingInterval': polling,
                     # Missing telemetry must not look like zero demand. Fail to the bounded maximum.
                     'fallback': {'failureThreshold': 3, 'replicas': maximum, 'behavior': 'static'},
                     'advanced': {'restoreToOriginalReplicaCount': False, 'horizontalPodAutoscalerConfig': {
                         'behavior': behavior(down_seconds)}}, 'triggers': [trigger]}}


def gateway_scaler(namespace, prometheus, minimum=3, maximum=6, target=2500,
                   down_seconds=300, polling=15):
    if type(target) is not int or not 1 <= target <= 5000:
        raise ValueError('Connection target must leave headroom below 6000')
    parsed = urlparse(prometheus)
    if parsed.scheme not in ['http', 'https'] or not parsed.hostname or parsed.username \
            or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Invalid Prometheus address')
    if not re.fullmatch(r'[a-z0-9]([-a-z0-9]*[a-z0-9])?', namespace):
        raise ValueError('Invalid namespace')
    selector = f'job="realtime",namespace="{namespace}"'
    # A partially failed scrape is an error too; sum() alone would silently lose those clients.
    query = f'sum(realtime_connections{{{selector}}}) and on() (min(up{{{selector}}}) == 1)'
    trigger = {'type': 'prometheus', 'metricType': 'AverageValue', 'metadata': {
        'serverAddress': prometheus, 'query': query, 'threshold': str(target),
        'ignoreNullValues': 'false', 'timeout': '2000'}}
    return scaled_object(namespace, 'realtime', trigger, minimum, maximum, down_seconds, polling)


def postgres_scaler(namespace, name, secret, query, target, maximum):
    # The secret holds a dedicated read-only connection; no application password enters manifests.
    auth = {'apiVersion': 'keda.sh/v1alpha1', 'kind': 'TriggerAuthentication',
            'metadata': {'name': name + '-scaling', 'namespace': namespace},
            'spec': {'secretTargetRef': [{'parameter': 'connection', 'name': secret, 'key': 'connection'}]}}
    trigger = {'type': 'postgresql', 'metricType': 'AverageValue',
               'authenticationRef': {'name': name + '-scaling'},
               'metadata': {'query': query, 'targetQueryValue': str(target)}}
    return [auth, scaled_object(namespace, name, trigger, 2, maximum)]


def cpu_hpa(namespace, name, minimum, maximum):
    return {'apiVersion': 'autoscaling/v2', 'kind': 'HorizontalPodAutoscaler',
            'metadata': {'name': name, 'namespace': namespace}, 'spec': {
                'scaleTargetRef': {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'name': name},
                'minReplicas': minimum, 'maxReplicas': maximum, 'behavior': behavior(),
                'metrics': [{'type': 'Resource', 'resource': {'name': 'cpu', 'target': {
                    'type': 'Utilization', 'averageUtilization': 65}}}]}}


def render(config, items):
    settings = config.get('autoscaling', {})
    if not settings.get('enabled', False):
        return []
    namespace = config.get('namespace', 'lecturer')
    limits = {key: settings.get(key, default) for key, default in [
        ('coreMax', 6), ('realtimeMax', 6), ('contentMax', 4), ('converterMax', 4),
        ('analyticsMax', 4), ('databaseConnections', 180), ('reservedConnections', 30),
        ('analyticsDatabaseConnections', 60), ('analyticsReservedConnections', 20)]}
    if any(type(value) is not int or value < 1 for value in limits.values()):
        raise ValueError('Scaling budgets must be positive integers')
    if any(limits[k] < floor or limits[k] > 16 for k, floor in [
        ('coreMax', 2), ('realtimeMax', 3), ('contentMax', 2), ('converterMax', 2), ('analyticsMax', 2)]):
        raise ValueError('Scaling bounds violate minimum HA or maximum replica limits')
    # Match the actual Hikari pools in the rendered deployments, not just their initial replicas.
    needed = limits['coreMax'] * (12 + 4) + limits['contentMax'] * 4 + limits['reservedConnections']
    if needed > limits['databaseConnections']:
        raise ValueError(f'Maximum replicas require {needed} DB connections, budget is {limits["databaseConnections"]}')
    if limits['analyticsMax'] * 4 + limits['analyticsReservedConnections'] > limits['analyticsDatabaseConnections']:
        raise ValueError('Analytics replicas exceed their separate database connection budget')
    address = settings.get('prometheusAddress')
    if not address:
        raise ValueError('Configure autoscaling.prometheusAddress and deploy a scraper for realtime pods')
    budgets = local_budgets(settings, limits['coreMax'])
    result = [gateway_scaler(namespace, address, maximum=limits['realtimeMax']),
              cpu_hpa(namespace, 'core', 2, limits['coreMax']),
              cpu_hpa(namespace, 'converter', 2, limits['converterMax'])]
    result += postgres_scaler(namespace, 'content-worker', 'lecturer-scaling-content',
        "SELECT count(*) FROM content.import_jobs WHERE (status='PENDING' AND available_at<=now()) "
        "OR status='RUNNING'", 2, limits['contentMax'])
    result += postgres_scaler(namespace, 'analytics', 'lecturer-scaling-analytics',
        'SELECT count(*) FROM report_jobs WHERE NOT dead AND (next_attempt_at<=now() OR lease_until>now())',
        8, limits['analyticsMax'])
    for item in items:
        if item['kind'] != 'Deployment':
            continue
        name = item['metadata']['name']
        container = item['spec']['template']['spec']['containers'][0]
        if name in ['core', 'realtime', 'converter', 'content-worker', 'analytics']:
            # HPA owns scale after activation; subsequent releases must not reset its desired count.
            item['spec'].pop('replicas', None)
        if name in ['core', 'converter']:
            container['resources']['requests']['cpu'] = '500m'
        if name == 'core':
            container['env'].extend({'name': key, 'value': str(value)} for key, value in budgets.items())
        if name == 'realtime':
            container['env'].append({'name': 'DRAIN_WINDOW_MS', 'value': '20000'})
    return result


def prometheus_config(namespace, interval='15s'):
    return {'global': {'scrape_interval': interval}, 'scrape_configs': [{
        'job_name': 'realtime', 'kubernetes_sd_configs': [{'role': 'pod', 'namespaces': {'names': [namespace]}}],
        'relabel_configs': [
            {'source_labels': ['__meta_kubernetes_pod_label_app_kubernetes_io_component'],
             'regex': 'realtime', 'action': 'keep'},
            {'source_labels': ['__meta_kubernetes_pod_container_port_number'], 'regex': '8091', 'action': 'keep'},
            {'source_labels': ['__meta_kubernetes_namespace'], 'target_label': 'namespace'},
            {'source_labels': ['__meta_kubernetes_pod_name'], 'target_label': 'pod'}]}]}
