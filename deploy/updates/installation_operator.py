#!/usr/bin/env python3
"""Pull approved update jobs from the application; never accept inbound privileged commands."""
import argparse
import base64
import contextlib
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import random
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

IMAGE = re.compile(r'[a-zA-Z0-9._:/-]+@sha256:[a-f0-9]{64}\Z')
RESOURCE = re.compile(r'(deployment|daemonset)/[a-z0-9][a-z0-9.-]*\Z')


class UpdateError(Exception):
    pass


def unique_object(items):
    result = {}
    for key, value in items:
        if key in result:
            raise UpdateError('Duplicate JSON key')
        result[key] = value
    return result


def decode(data):
    return json.loads(data, object_pairs_hook=unique_object)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.update-')
    try:
        with os.fdopen(descriptor, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_release(envelope, public_key, release_id=None, openssl='openssl'):
    payload = envelope['payload']
    if not isinstance(payload, str) or len(payload.encode()) > 262144:
        raise UpdateError('Catalog size exceeded')
    signature = base64.b64decode(envelope['signature'], validate=True)
    if len(signature) != 64:
        raise UpdateError('Expected an Ed25519 signature')
    with tempfile.TemporaryDirectory(prefix='lecturer-release-') as directory:
        message, sig = Path(directory) / 'catalog', Path(directory) / 'signature'
        message.write_bytes(payload.encode())
        sig.write_bytes(signature)
        result = subprocess.run([openssl, 'pkeyutl', '-verify', '-pubin', '-inkey', str(public_key),
                                 '-rawin', '-in', str(message), '-sigfile', str(sig)],
                                capture_output=True, timeout=10, check=False)
        if result.returncode:
            raise UpdateError('Catalog signature is not trusted')
    catalog = decode(payload)
    if catalog.get('schema') != 1 or len(catalog.get('releases', [])) > 30:
        raise UpdateError('Unsupported catalog schema')
    expires = dt.datetime.fromisoformat(catalog['expiresAt'].replace('Z', '+00:00'))
    if expires <= dt.datetime.now(dt.timezone.utc):
        raise UpdateError('Catalog expired')
    ids = set()
    for release in catalog['releases']:
        identifier = release['id']
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}', identifier) or identifier in ids:
            raise UpdateError('Invalid release ID')
        ids.add(identifier)
        if not re.fullmatch(r'[a-f0-9]{40}', release['commit']) or release.get('backwardCompatible') is not True:
            raise UpdateError('Only backward-compatible application releases are supported')
        images = release['images']
        if not isinstance(images, dict) or not {'core', 'web'} <= images.keys() or len(images) > 12:
            raise UpdateError('Required application images are missing')
        if any(not re.fullmatch(r'core|web|services|sfu|max-adapter|converter|authority', key)
               or not isinstance(value, str) or not IMAGE.fullmatch(value) for key, value in images.items()):
            raise UpdateError('Images must be pinned to immutable digests')
        if type(release['databaseMin']) is not int or type(release['databaseMax']) is not int \
                or not 0 <= release['databaseMin'] <= release['databaseMax']:
            raise UpdateError('Invalid database compatibility interval')
    if release_id is None:
        return catalog
    for release in catalog['releases']:
        if release['id'] == release_id:
            return release
    raise UpdateError('Approved release is absent from signed catalog')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise UpdateError('Redirects are disabled for operator requests')


class Api:
    def __init__(self, config):
        self.url = config['apiUrl'].rstrip('/')
        parsed = urllib.parse.urlparse(self.url)
        if parsed.username or parsed.password or parsed.query or parsed.fragment \
                or (parsed.scheme != 'https' and not (parsed.scheme == 'http'
                    and (parsed.hostname in ['127.0.0.1', 'localhost', '::1'] or
                         (config.get('backend') == 'appliance' and self.url == 'http://k3s:30080')))):
            raise UpdateError('API requires HTTPS or a local loopback address')
        self.key = config['operatorKey']
        if len(self.key) < 32 or self.key.startswith("REPLACE"):
            raise UpdateError('Operator credential must contain at least 32 characters')
        self.opener = urllib.request.build_opener(NoRedirect)

    def post(self, path, value, deadline=90):
        until = time.monotonic() + deadline
        attempt = 0
        while True:
            request = urllib.request.Request(self.url + '/api/v1/installation-operator' + path,
                data=json.dumps(value).encode(), headers={'Content-Type': 'application/json',
                    'X-Installation-Key': self.key}, method='POST')
            try:
                with self.opener.open(request, timeout=min(8, max(.1, until-time.monotonic()))) as response:
                    body = response.read(524289)
                    if len(body) > 524288:
                        raise UpdateError('API response too large')
                    return decode(body) if body else None
            except urllib.error.HTTPError as error:
                if error.code not in [429, 500, 502, 503, 504]:
                    raise UpdateError(f'Operator request rejected ({error.code})') from None
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            remaining = until-time.monotonic()
            if remaining <= 0:
                raise UpdateError('API retry budget exhausted')
            time.sleep(min(remaining, random.uniform(.5, 1) * min(15, 2 ** min(attempt, 5))))
            attempt += 1


def command(argv, config, log, timeout=600):
    """Arguments are fixed by the driver or locally provisioned config, never shell text from a job."""
    try:
        result = subprocess.run(argv, cwd=config['repo'], stdout=log, stderr=subprocess.STDOUT,
                                timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise UpdateError('Deployment command exceeded its deadline') from None
    if result.returncode:
        raise UpdateError('Deployment command failed; inspect the private operator log')


def capture(argv, config, timeout=30):
    result = subprocess.run(argv, cwd=config['repo'], capture_output=True, timeout=timeout, check=False)
    if result.returncode or len(result.stdout) > 1048576:
        raise UpdateError('Could not verify running application images')
    return result.stdout.decode().strip()


class Compose:
    def __init__(self, config, state, run=command, read=capture):
        self.config, self.state, self.run, self.read = config, Path(state), run, read
        self.guard = lambda: None
        self.bindings = config['bindings']
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', config['project']):
            raise UpdateError('Invalid Compose project')
        mode = next((line.split('=', 1)[1].strip() for line in
                     (Path(config['repo']) / '.env').read_text().splitlines() if line.startswith('PUBLIC_MODE=')), 'domain')
        expected_files = ['docker-compose.yml', 'docker-compose.prod.yml']
        if mode == 'tunnel':
            expected_files.append('docker-compose.tunnel.yml')
        if config['composeFiles'] != expected_files:
            raise UpdateError('Compose descriptors must match the cloud backup installer')
        self.base = ['docker', 'compose', '-p', config['project']]
        for file in config['composeFiles']:
            self.base += ['-f', str(Path(config['repo']) / file)]
        self.override = Path(config['repo']) / 'deploy/updates/.state/managed-images.json'
        self.override.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.previous = self.state / 'previous-images.json'

    def preflight(self, release, log):
        if set(release['images']) - self.bindings.keys() or any(not self.bindings[key] for key in release['images']):
            raise UpdateError('This release needs an operator/topology upgrade')
        if shutil.disk_usage(self.state).free < self.config.get('minFreeBytes', 2*1024**3):
            raise UpdateError('Insufficient free space for update')
        # A separate proposed override leaves the current descriptor unchanged until the backup succeeds.
        self.proposed = self.state / 'proposed-images.json'
        self.services = sorted({name for component in release['images'] for name in self.bindings[component]})
        previous = decode(self.override.read_text()) if self.override.exists() else {'services': {}}
        override = {'services': {**previous['services'], **{name: {'image': image}
                    for component, image in release['images'].items() for name in self.bindings[component]}}}
        atomic_json(self.proposed, override)
        self.run(self.base + ['-f', str(self.proposed), 'pull', *self.services], self.config, log)

    def backup(self, log):
        self.run(['env', f'LECTURER_COMPOSE_PROJECT={self.config["project"]}', 'sh',
                  str(Path(self.config['repo']) / 'deploy/cloud/lecturer.sh'), 'backup'], self.config, log)

    def apply(self, release, log):
        self.guard()
        if self.override.exists():
            atomic_json(self.previous, decode(self.override.read_text()))
        os.replace(self.proposed, self.override)
        self.run(self.base + ['-f', str(self.override), 'up', '-d', '--no-build', '--no-deps',
                             '--wait', '--wait-timeout', '240', *self.services], self.config, log)

    def verify(self, release, log):
        for component, image in release['images'].items():
            for service in self.bindings[component]:
                ids = self.read(self.base + ['-f', str(self.override), 'ps', '-q', service], self.config).split()
                if not ids:
                    raise UpdateError('An updated Compose service is absent')
                for container in ids:
                    actual = self.read(['docker', 'inspect', '--format', '{{.Config.Image}}', container], self.config)
                    if actual != image:
                        raise UpdateError('Running Compose image does not match the approved digest')


class Kubernetes:
    def __init__(self, config, state, run=command, read=capture):
        self.config, self.state, self.run, self.read = config, Path(state), run, read
        self.guard = lambda: None
        self.bindings = config['bindings']
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', config['namespace']):
            raise UpdateError('Invalid Kubernetes namespace')
        self.base = ['env', f'LECTURER_K8S_NAMESPACE={config["namespace"]}', 'sh',
                     str(Path(config['repo']) / 'deploy/k8s/lecturer-k8s.sh'), 'kubectl', '-n', config['namespace']]
        if config.get('backend') == 'appliance':
            self.base = ['kubectl', '--kubeconfig', config['kubeconfig'], '-n', config['namespace']]
        for mappings in self.bindings.values():
            for mapping in mappings:
                if not RESOURCE.fullmatch(mapping['resource']) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]*', mapping['container']):
                    raise UpdateError('Only existing application workloads are supported')

    def preflight(self, release, log):
        if set(release['images']) - self.bindings.keys() or any(not self.bindings[key] for key in release['images']):
            raise UpdateError('This release needs an operator/topology upgrade')
        for component in release['images']:
            for target in self.bindings[component]:
                self.run(self.base + ['get', target['resource'], '-o', 'name'], self.config, log, timeout=30)
        if self.config.get('backend') == 'appliance':
            if shutil.disk_usage(self.state).free < self.config.get('minFreeBytes', 2*1024**3):
                raise UpdateError('Insufficient free space for update')
            # Pull every digest BEFORE claiming the maintenance barrier or changing workloads.
            # On this one-node topology a completed utility pod warms the exact node cache.
            for component, image in release['images'].items():
                name = 'release-pull-' + uuid.uuid4().hex[:20]
                manifest = self.state / 'preflight-pod.json'
                atomic_json(manifest, {'apiVersion': 'v1', 'kind': 'Pod', 'metadata': {
                    'name': name, 'namespace': self.config['namespace']}, 'spec': {
                    'restartPolicy': 'Never', 'automountServiceAccountToken': False,
                    'containers': [{'name': 'pull', 'image': image, 'imagePullPolicy': 'IfNotPresent',
                        'command': ['/bin/true'], 'securityContext': {'runAsUser': 65534, 'runAsNonRoot': True,
                            'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}},
                        'resources': {'requests': {'cpu': '5m', 'memory': '8Mi'},
                                      'limits': {'cpu': '100m', 'memory': '32Mi'}}}]}})
                try:
                    self.run(self.base + ['apply', '-f', str(manifest)], self.config, log, timeout=30)
                    self.run(self.base + ['wait', '--for=jsonpath={.status.phase}=Succeeded',
                                         'pod/'+name, '--timeout=180s'], self.config, log, timeout=190)
                finally:
                    self.run(self.base + ['delete', 'pod/'+name, '--ignore-not-found', '--wait=true', '--timeout=90s'],
                             self.config, log, timeout=100)

    def backup(self, log):
        if self.config.get('backend') == 'appliance':
            self.run(['python3', str(Path(self.config['repo']) / 'deploy/appliance/control.py'),
                      'backup'], self.config, log)
            return
        self.run(['env', f'LECTURER_K8S_NAMESPACE={self.config["namespace"]}', 'sh',
                  str(Path(self.config['repo']) / 'deploy/k8s/lecturer-k8s.sh'), 'backup'], self.config, log)

    def apply(self, release, log):
        previous = {}
        for component in release['images']:
            for target in self.bindings[component]:
                current = decode(self.read(self.base + ['get', target['resource'], '-o', 'json'], self.config))
                previous[target['resource']] = {c['name']: c['image'] for c in
                    current['spec']['template']['spec']['containers']}
        atomic_json(self.state / 'previous-images.json', previous)
        for component, image in release['images'].items():
            for target in self.bindings[component]:
                self.guard()
                self.run(self.base + ['set', 'image', target['resource'], f'{target["container"]}={image}'],
                         self.config, log, timeout=60)
                # OnDelete is intentional for live media. The admission barrier has already
                # excluded active/scheduled lessons; now replace only this workload's pods.
                current = decode(self.read(self.base + ['get', target['resource'], '-o', 'json'], self.config))
                if target['resource'].startswith('daemonset/') and current['spec'].get('updateStrategy', {}).get('type') == 'OnDelete':
                    selector = self.selector(current)
                    pods = decode(self.read(self.base + ['get', 'pods', '-l', selector, '-o', 'json'], self.config))
                    for pod in pods['items']:
                        self.guard()
                        self.run(self.base + ['delete', 'pod', pod['metadata']['name'], '--wait=true', '--timeout=90s'],
                                 self.config, log, timeout=100)
                # At most one rolling-update surge may consume the reserved namespace budget.
                self.wait_ready(target, log)

    def wait_ready(self, target, log):
        current = decode(self.read(self.base + ['get', target['resource'], '-o', 'json'], self.config))
        if current['spec'].get('updateStrategy', {}).get('type') == 'OnDelete':
            desired = current.get('status', {}).get('desiredNumberScheduled', 0)
            if not desired: raise UpdateError('Media workload has no scheduled nodes')
            for field in ['updatedNumberScheduled', 'numberReady']:
                self.run(self.base + ['wait', f'--for=jsonpath={{.status.{field}}}={desired}',
                                     target['resource'], '--timeout=240s'], self.config, log, timeout=250)
        else:
            self.run(self.base + ['rollout','status',target['resource'],'--timeout=240s'], self.config, log, timeout=250)
        # Deployment availability may precede final deletion of its old pods. Do not
        # spend the next workload's surge budget while that memory is still charged.
        deadline=time.monotonic()+240
        while True:
            pods=decode(self.read(self.base+['get','pods','-l',self.selector(current),'-o','json'],self.config))
            if not any(p.get('metadata',{}).get('deletionTimestamp') for p in pods.get('items',[])): break
            if time.monotonic()>=deadline: raise UpdateError('Old workload pods did not terminate')
            time.sleep(2)

    @staticmethod
    def selector(workload):
        labels = workload['spec']['selector'].get('matchLabels', {})
        if not labels or workload['spec']['selector'].get('matchExpressions'):
            raise UpdateError('Workload needs an explicit label selector')
        return ','.join(f'{key}={value}' for key, value in sorted(labels.items()))

    def verify(self, release, log):
        for component in release['images']:
            for target in self.bindings[component]:
                current = decode(self.read(self.base + ['get', target['resource'], '-o', 'json'], self.config))
                if current['spec'].get('updateStrategy', {}).get('type') == 'OnDelete':
                    desired = current.get('status', {}).get('desiredNumberScheduled', 0)
                    if not desired:
                        raise UpdateError('Media workload has no scheduled nodes')
                    for field in ['updatedNumberScheduled', 'numberReady']:
                        self.run(self.base + ['wait', f'--for=jsonpath={{.status.{field}}}={desired}',
                                             target['resource'], '--timeout=240s'], self.config, log, timeout=250)
                else:
                    self.run(self.base + ['rollout', 'status', target['resource'], '--timeout=240s'],
                             self.config, log, timeout=250)
                actual = {c['name']: c['image'] for c in current['spec']['template']['spec']['containers']}
                if actual.get(target['container']) != release['images'][component]:
                    raise UpdateError('Running Kubernetes image does not match the approved digest')
                selector = self.selector(current)
                pods = decode(self.read(self.base + ['get', 'pods', '-l', selector, '-o', 'json'], self.config))['items']
                running = [pod for pod in pods if not pod['metadata'].get('deletionTimestamp')]
                if not running:
                    raise UpdateError('Updated workload has no running pods')
                for pod in running:
                    containers = {c['name']: c['image'] for c in pod['spec']['containers']}
                    ready = any(c.get('type') == 'Ready' and c.get('status') == 'True'
                                for c in pod.get('status', {}).get('conditions', []))
                    if containers.get(target['container']) != release['images'][component] or not ready:
                        raise UpdateError('Actual pod digest/readiness does not match the approved release')
        descriptor = Path(self.config.get('imagesFile', Path(self.config['repo']) / 'deploy/k8s/.state/images.json'))
        previous = decode(descriptor.read_text()) if descriptor.exists() else {}
        atomic_json(self.state / 'previous-descriptor.json', previous)
        atomic_json(descriptor, {**previous, **release['images']})


def health(config):
    url = config['healthUrl']
    parsed = urllib.parse.urlparse(url)
    if (parsed.scheme != 'https' and parsed.hostname not in ['127.0.0.1', 'localhost', '::1']
            and not (config.get('backend') == 'appliance' and url == 'http://k3s:30080/health')):
        raise UpdateError('Health endpoint requires HTTPS')
    with urllib.request.build_opener(NoRedirect).open(url, timeout=8) as response:
        data = decode(response.read(65536))
        if response.status != 200 or data.get('status') != 'UP':
            raise UpdateError('Public application health check failed')


class Worker:
    def __init__(self, config, api=None, driver=None):
        self.config = config
        self.state = Path(config['stateDir'])
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.api = api or Api(config)
        self.driver = driver or {'compose': Compose, 'kubernetes': Kubernetes}[config['kind']](config, self.state)
        self.journal = self.state / 'journal.json'
        self.owner_path = self.state / 'owner.json'
        if not self.owner_path.exists():
            atomic_json(self.owner_path, {'owner': str(uuid.uuid4())})
        self.owner = decode(self.owner_path.read_text())['owner']
        self.stop = threading.Event()

    def rpc(self, job, method, deadline=90, **values):
        return self.api.post(f'/jobs/{job["id"]}/{method}',
                             {'owner': self.owner, 'fence': job['fence'], **values}, deadline=deadline)

    def sync(self):
        url = self.config['catalogUrl']
        if urllib.parse.urlparse(url).scheme != 'https':
            raise UpdateError('Catalog URL requires HTTPS')
        with urllib.request.build_opener(NoRedirect).open(url, timeout=15) as response:
            raw = response.read(524289)
        if len(raw) > 524288:
            raise UpdateError('Catalog size exceeded')
        envelope = decode(raw)
        validate_release(envelope, self.config['publicKey'], openssl=self.config.get('openssl', 'openssl'))
        self.api.post('/catalog', {'kind': self.config['kind'], **envelope})

    def execute(self, assignment):
        job = assignment['job']
        log_path = self.state / f'{job["id"]}.log'
        stop_heartbeat = threading.Event()
        def heartbeat():
            while not stop_heartbeat.wait(15):
                try:
                    self.rpc(job, 'heartbeat', deadline=8)
                except (UpdateError, OSError):
                    # Every next mutation also checks the server fencing token. A transient API
                    # restart is expected, but a lost lease never authorizes the next command.
                    pass
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        phase = 'PREFLIGHT'
        self.driver.guard = lambda: self.rpc(job, 'heartbeat')
        try:
            release = validate_release(assignment['catalog'], self.config['publicKey'], job['releaseId'],
                                       openssl=self.config.get('openssl', 'openssl'))
            if self.journal.exists():
                prior = decode(self.journal.read_text())
                if prior.get('active') == job['id']:
                    self.rpc(job, 'progress', stage='NEEDS_ATTENTION',
                             summary='Оператор перезапустился. Требуется ручная проверка установки')
                    return
                if prior.get('active'):
                    # The unique active-job constraint permits a new assignment only after
                    # the previous uncertain job was reviewed by an administrator.
                    archive = self.state / f'reviewed-{uuid.UUID(prior["active"])}.json'
                    atomic_json(archive, prior)
            atomic_json(self.journal, {'active': job['id'], 'stage': phase, 'release': release})
            descriptor = os.open(log_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            with os.fdopen(descriptor, 'w') as log:
                self.driver.preflight(release, log)
                while True:
                    if self.stop.is_set():
                        raise UpdateError('Operator stopping before maintenance')
                    ready = self.rpc(job, 'prepare')
                    if ready['stage'] == 'BACKING_UP':
                        break
                    self.stop.wait(15)
                phase = 'BACKING_UP'
                atomic_json(self.journal, {'active': job['id'], 'stage': phase, 'release': release})
                self.driver.backup(log)
                self.rpc(job, 'progress', stage='APPLYING', summary='Резервная копия проверена. Обновляем приложение')
                phase = 'APPLYING'
                atomic_json(self.journal, {'active': job['id'], 'stage': phase, 'release': release})
                self.driver.apply(release, log)
                self.rpc(job, 'progress', stage='VERIFYING', summary='Проверяем готовность сервисов')
                phase = 'VERIFYING'
                self.driver.verify(release, log)
                health(self.config)
                self.rpc(job, 'progress', stage='SUCCEEDED', summary='Обновление установлено и проверено')
                atomic_json(self.journal, {'active': None, 'stage': 'SUCCEEDED', 'release': release})
        except Exception:
            # Raw subprocess output and exception URLs may contain local configuration or secrets.
            stage = 'NEEDS_ATTENTION' if phase in ['APPLYING', 'VERIFYING'] else 'FAILED'
            with contextlib.suppress(UpdateError, OSError):
                self.rpc(job, 'progress', stage=stage,
                         summary='Обновление остановлено. Подробности в закрытом журнале оператора')
            if stage == 'FAILED':
                atomic_json(self.journal, {'active': None, 'stage': stage})
            raise
        finally:
            stop_heartbeat.set()
            thread.join(timeout=10)

    def run(self):
        with open(self.state / 'operator.lock', 'w') as lock:
            os.fchmod(lock.fileno(), 0o600)
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            sync_at = 0
            attempt = 0
            while not self.stop.is_set():
                try:
                    if time.monotonic() >= sync_at:
                        self.sync()
                        sync_at = time.monotonic() + 60
                    assignment = self.api.post('/claim', {'owner': self.owner})
                    if assignment:
                        self.execute(assignment)
                    attempt = 0
                    self.stop.wait(5 + random.random()*3)
                except (UpdateError, OSError, ValueError):
                    # No automatic deployment replay after an uncertain result; the journal fences it.
                    attempt += 1
                    print('Operator is waiting; inspect its private journal and application update status.', flush=True)
                    self.stop.wait(random.uniform(.5, 1) * min(60, 2**min(attempt, 6)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    config_path = Path(args.config)
    if config_path.stat().st_mode & 0o077:
        raise UpdateError('Operator config must have mode 600')
    config = decode(config_path.read_text())
    if config['kind'] not in ['compose', 'kubernetes'] or not Path(config['repo']).is_absolute():
        raise UpdateError('Invalid local operator configuration')
    Worker(config).run()


if __name__ == '__main__':
    main()
