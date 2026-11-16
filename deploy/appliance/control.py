#!/usr/bin/env python3
"""Provision and operate the Docker-contained single-node installation. No Docker socket."""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import random
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

from render import NS, IMAGE_KEYS, site_renderer, validate, app, data, secrets as secret_items, scaling, monitoring, resource_budget

ROOT = Path(__file__).resolve().parents[2]
STATE = Path(os.environ.get('APPLIANCE_STATE', '/state'))
BACKUPS = Path(os.environ.get('APPLIANCE_BACKUPS', '/backups'))
KUBE = STATE/'kubeconfig.yaml'


def atomic(path, value):
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.'+path.name+'-')
    try:
        with os.fdopen(descriptor, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(value)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def read(name):
    return json.loads((STATE/name).read_text())


def checksum(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def kc(*args, input=None, timeout=600, capture=True):
    # Only declarative apply and reads are safe to repeat after an ambiguous API
    # disconnect. Never replay exec/SQL/restore streams as if they were reads.
    safe = args[0] in ['get', 'apply']
    for attempt in range(4):
        result = subprocess.run(['kubectl', '--kubeconfig', str(KUBE), *args], input=input,
                                capture_output=capture, timeout=timeout, check=False)
        if not result.returncode:
            return result.stdout if capture else b''
        message = result.stderr.decode(errors='replace')[-3000:] if capture else ''
        transient = any(text in message for text in ['TLS handshake timeout', 'connection refused',
                        'connection reset', 'unexpected EOF', 'i/o timeout', 'ServiceUnavailable'])
        if safe and transient and attempt < 3:
            time.sleep(random.uniform(.5, 1) * 2**attempt)
            continue
        # Do not log stdin (may hold secrets or SQL passwords).
        raise RuntimeError('kubectl '+str(args[0])+': '+message)


def apply(items):
    if items:
        kc('apply', '-f', '-', input=json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': items}).encode())


def wait(resource, namespace=NS, timeout=360):
    if resource.startswith('daemonset/'):
        kc('-n', namespace, 'wait', '--for=jsonpath={.status.numberReady}=1', resource,
           f'--timeout={timeout}s', timeout=timeout+15)
        return
    kc('-n', namespace, 'rollout', 'status', resource, f'--timeout={timeout}s', timeout=timeout+15)


def sql(database, query):
    pod = 'app-db-0' if database == 'lecturer' else 'analytics-db-0'
    return kc('-n', NS, 'exec', '-i', pod, '--', 'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1',
              '-U', 'postgres', '-d', database, input=query.encode()).decode().strip()


def quote(value):
    return "'"+value.replace("'", "''")+"'"


def init():
    os.umask(0o077)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    config, images = read('site.json'), read('images.json')
    validate(config, images)
    if config.get('updates'):
        checked = subprocess.run(['openssl', 'pkey', '-pubin', '-text', '-noout'],
            input=config['updates']['publicKey'].encode(), capture_output=True, check=False)
        if checked.returncode or b'ED25519' not in checked.stdout:
            raise RuntimeError('Update verification key must be a valid Ed25519 public key')
    if (STATE/'secrets.json').exists():
        raise RuntimeError('Already initialized; refusing to replace installation credentials')
    keys = site_renderer.RUNTIME_KEYS + ['PG_SUPERUSER_PASSWORD', 'ANALYTICS_SUPERUSER_PASSWORD',
        'DB_PASSWORD', 'ANALYTICS_DB_PASSWORD', 'CONTENT_DB_PASSWORD', 'CONTENT_SCALER_PASSWORD',
        'ANALYTICS_SCALER_PASSWORD', 'RABBITMQ_PASSWORD', 'REDIS_PASSWORD', 'INSTALLATION_OPERATOR_KEY', 'CONVERTER_API_KEY', 'RABBIT_PUBLISHER_PASSWORD','RABBIT_ANALYTICS_PASSWORD','RABBIT_REALTIME_PASSWORD']
    values = {key: secrets.token_hex(32) for key in keys}
    values['MAX_WEBHOOK_PATH'] = '/webhook/max/'+secrets.token_hex(20)
    token_file = STATE/'max-token'
    if token_file.exists():
        values['MAX_BOT_TOKEN'] = token_file.read_text().strip()
        token_file.unlink()
    origin = __import__('urllib.parse', fromlist=['urlparse']).urlparse(config['publicOrigin'])
    # TLS mode obtains certificates at the VM. Proxy mode accepts only the loopback
    # host binding by default; the university's ingress must terminate trusted HTTPS.
    domain = origin.netloc if config.get('tlsMode', 'proxy') == 'automatic' else ':80'
    if config.get('tlsMode', 'proxy') not in ['proxy', 'automatic']:
        raise RuntimeError('tlsMode must be proxy or automatic')
    atomic(STATE/'secrets.json', json.dumps(values))
    atomic(STATE/'registries.yaml', json.dumps(config.get('registries', {})))
    caddy = f'{domain} {{\n  reverse_proxy k3s:30080\n  encode zstd gzip\n}}\n'
    atomic(STATE/'Caddyfile', caddy)
    atomic(STATE/'runtime.env', f'CLUSTER_MEMORY={config.get("clusterMemoryMi",13312)}m\nCLUSTER_CPUS={config.get("clusterCpus",8)}\n')
    print('Initialized. Credentials are private in the state directory; no administrator exists yet.')


def connect():
    raw = Path('/cluster/kubeconfig.yaml').read_text()
    raw = re.sub(r'server: https://[^\n]+', 'server: https://k3s:6443', raw)
    atomic(KUBE, raw)
    kc('get', '--raw=/readyz')


def base():
    config, images, values = read('site.json'), read('images.json'), read('secrets.json')
    validate(config, images)
    apply([{'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': NS}}])
    apply(data(config, values))
    for name in ['app-db', 'analytics-db', 'events']:
        wait('statefulset/'+name)
    for db, roles in [('lecturer', [('lecturer', 'DB_PASSWORD'), ('content_worker', 'CONTENT_DB_PASSWORD'),
                                  ('content_scaler', 'CONTENT_SCALER_PASSWORD')]),
                      ('analytics', [('analytics', 'ANALYTICS_DB_PASSWORD'), ('analytics_scaler', 'ANALYTICS_SCALER_PASSWORD')])]:
        for name, key in roles:
            sql(db, f"SELECT 'CREATE ROLE {name} LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname={quote(name)})\\gexec\n"
                    f'ALTER ROLE {name} PASSWORD {quote(values[key])};\n')
        sql(db, f'ALTER DATABASE {db} OWNER TO {roles[0][0]};')
    apply(secret_items(config, values))


def bootstrap():
    config, images = read('site.json'), read('images.json')
    fingerprint = hashlib.sha256(json.dumps([config, read('secrets.json')], sort_keys=True).encode()).hexdigest()
    cluster_id = json.loads(kc('get', 'namespace', 'kube-system', '-o', 'json'))['metadata']['uid']
    marker = STATE/'installed.json'
    if marker.exists() and read('installed.json') == {'cluster': cluster_id, 'config': fingerprint}:
        print('Existing installation; preserving workloads, HPA scales and image digests.', flush=True)
        return
    if marker.exists() and read('installed.json')['cluster'] == cluster_id:
        raise RuntimeError('Installation configuration changed. Use a reviewed maintenance procedure; existing workloads were preserved')
    base()
    workloads = app(config, images)
    for item in workloads:
        if item['kind'] in ['Deployment', 'DaemonSet']:
            item['spec']['template']['metadata'].setdefault('annotations', {})['lecturer/configuration'] = fingerprint
    apply(workloads)
    wait('deployment/core')
    wait('deployment/analytics')
    sql('lecturer', (ROOT/'deploy/scalable/ha/scaling-content.sql').read_text())
    sql('analytics', (ROOT/'deploy/scalable/ha/scaling-analytics.sql').read_text())
    apply(monitoring(config))
    # Official, version-pinned controller; CRDs use server-side apply (large schemas).
    manifest = str(ROOT/'keda.yaml')
    kc('apply', '--server-side', '--field-manager=lecturer-bootstrap', '-f', manifest, timeout=300)
    for name in ['keda-operator','keda-metrics-apiserver','keda-admission']:
        kc('-n','keda','set','resources','deployment/'+name,'--containers=*',
           '--requests=cpu=50m,memory=64Mi','--limits=cpu=500m,memory=256Mi')
    for name in ['keda-operator', 'keda-metrics-apiserver', 'keda-admission']:
        wait('deployment/'+name, namespace='keda')
    apply(scaling(config, images))
    for name in ['core', 'content-worker', 'converter', 'realtime', 'event-publisher', 'analytics',
                 'media-control', 'web', 'edge', 'authority', 'max-adapter']:
        wait('deployment/'+name)
    wait('daemonset/sfu')
    atomic(marker, json.dumps({'cluster': cluster_id, 'config': fingerprint}))
    print('Installation ready.', flush=True)


@contextlib.contextmanager
def blob_lock():
    guard = 'appliance-backup-'+secrets.token_hex(8)
    process = subprocess.Popen(['kubectl', '--kubeconfig', str(KUBE), '-n', NS, 'exec', 'app-db-0', '--',
        'env', 'PGAPPNAME='+guard, 'PGOPTIONS=-c statement_timeout=0 -c lock_timeout=60s',
        'psql', '-Xq', '-U', 'postgres', '-d', 'lecturer', '-v', 'ON_ERROR_STOP=1',
        '-c', 'select pg_advisory_lock(14713,2525); select pg_sleep(1800);'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    def held():
        return sql('lecturer', f"select exists(select from pg_locks l join pg_stat_activity a using(pid) "
                   f"where a.application_name={quote(guard)} and l.locktype='advisory' "
                   "and l.classid=14713 and l.objid=2525 and l.objsubid=2 and l.granted)") == 't'
    try:
        for _ in range(65):
            if held(): break
            if process.poll() is not None: raise RuntimeError('Backup lock failed')
            time.sleep(1)
        else: raise RuntimeError('Backup lock timeout')
        yield held
    finally:
        with contextlib.suppress(Exception):
            sql('lecturer', f"select pg_terminate_backend(pid) from pg_stat_activity where application_name={quote(guard)}")
        process.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired): process.wait(timeout=10)


def stream_exec(args, path, restore=False):
    with Path(path).open('rb' if restore else 'wb') as stream:
        result = subprocess.run(['kubectl', '--kubeconfig', str(KUBE), '-n', NS, 'exec',
                                 *(['-i'] if restore else []), *args],
                                stdin=stream if restore else subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL if restore else stream,
                                stderr=subprocess.PIPE, timeout=900, check=False)
    if result.returncode:
        raise RuntimeError('Backup/restore stream failed: '+result.stderr.decode(errors='replace')[-1000:])


def raw_backup(destination):
    os.umask(0o077)
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(4)
    temporary, final = destination/('.partial-'+stamp), destination/stamp
    temporary.mkdir(mode=0o700)
    try:
        with blob_lock() as held:
            materials=int(kc('-n',NS,'exec','deployment/core','--','du','-sb','/data/blobs').decode().split()[0])
            databases=sum(int(sql(db,'select pg_database_size(current_database())')) for db in ['lecturer','analytics'])
            required=int((materials+databases+128*1024**2)*1.3)+2*1024**3
            if shutil.disk_usage(destination).free < required:
                raise RuntimeError('Not enough free staging space for a backup and the disk reserve')
            # Capture the inbox first: every DONE event must precede the later SQL snapshot.
            # Pending/running events can replay after recovery; external sends are at least once.
            if kc('-n',NS,'get','deployment/max-adapter','--ignore-not-found','-o','name').strip():
                exists=kc('-n',NS,'exec','deployment/max-adapter','--','sh','-c',
                          'if test -f /data/max-inbox/inbox.sqlite; then echo yes; fi').strip()
                if exists:
                    stream_exec(['deployment/max-adapter','--','node','/app/inbox-snapshot.mjs'],temporary/'max-inbox.sqlite')
            stream_exec(['app-db-0', '--', 'pg_dump', '-U', 'postgres', '-Fc', '-d', 'lecturer'], temporary/'lecturer.dump')
            stream_exec(['deployment/core', '--', 'tar', '-czf', '-', '-C', '/data', 'blobs'], temporary/'blobs.tar.gz')
            if not held(): raise RuntimeError('Backup lock lost; refusing inconsistent snapshot')
        stream_exec(['analytics-db-0', '--', 'pg_dump', '-U', 'postgres', '-Fc', '-d', 'analytics'], temporary/'analytics.dump')
        for db in ['lecturer', 'analytics']:
            stream_exec([('app-db' if db == 'lecturer' else 'analytics-db')+'-0', '--', 'pg_restore', '--list'],
                        temporary/(db+'.dump'), restore=True)
        subprocess.run(['tar', '-tzf', str(temporary/'blobs.tar.gz')], stdout=subprocess.DEVNULL, check=True)
        for name in ['site.json', 'secrets.json', 'images.json']:
            shutil.copyfile(STATE/name, temporary/name)
        version = sql('lecturer', 'select version from shared.flyway_schema_history where success order by installed_rank desc limit 1')
        (temporary/'database-version').write_text(version+'\n')
        checksums = {p.name: checksum(p) for p in temporary.iterdir()}
        (temporary/'checksums.json').write_text(json.dumps(checksums))
        temporary.rename(final)
        return final
    finally:
        if temporary.exists(): shutil.rmtree(temporary)


def backup():
    from backup_schedule import publish
    final=publish(raw_backup,STATE,BACKUPS)
    print('Encrypted backup committed: '+str(final),flush=True)


def restore(source):
    # Deliberately only a NEW/EMPTY installation. Never overwrite a live institution.
    source = Path(source)
    sums = json.loads((source/'checksums.json').read_text())
    required = {'lecturer.dump', 'analytics.dump', 'blobs.tar.gz', 'site.json', 'images.json', 'secrets.json', 'database-version'}
    if not required.issubset(sums) or set(sums)-required-{'max-inbox.sqlite'}:
        raise RuntimeError('Incomplete backup manifest')
    for name, digest in sums.items():
        if checksum(source/name) != digest:
            raise RuntimeError('Backup checksum mismatch: '+name)
    if (STATE/'installed.json').exists(): raise RuntimeError('Restore requires a new installation')
    existing = json.loads(kc('-n', NS, 'get', 'pods', '-o', 'json'))['items'] if kc('get', 'namespace', NS, '--ignore-not-found').strip() else []
    if any(p['metadata']['name'].startswith('core-') for p in existing):
        raise RuntimeError('Application pods already exist; use a new installation for restore')
    for database, prefix in [('lecturer', 'app-db-'), ('analytics', 'analytics-db-')]:
        if any(p['metadata']['name'].startswith(prefix) for p in existing):
            if sql(database, "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')") != '0':
                raise RuntimeError('Database is not empty; restore refused before changing credentials')
    # A new project's generated keys must not replace the original signing/channel keys.
    for name in ['site.json', 'images.json', 'secrets.json']:
        atomic(STATE/name, (source/name).read_text())
    base()
    for database in ['lecturer', 'analytics']:
        if sql(database, "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')") != '0':
            raise RuntimeError('Database is not empty; restore refused')
    for database in ['lecturer', 'analytics']:
        stream_exec([('app-db' if database == 'lecturer' else 'analytics-db')+'-0', '--', 'pg_restore',
                     '--exit-on-error', '-U', 'postgres', '-d', database], source/(database+'.dump'), restore=True)
    if sql('lecturer', "select to_regclass('installation.jobs') is not null") == 't':
        # Restoring a snapshot must never replay an old privileged job against a new
        # cluster. Keep uncertain work visible and fenced until administrator review.
        sql('lecturer', """WITH fenced AS (
            UPDATE installation.jobs SET
              status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE 'NEEDS_ATTENTION' END,
              owner=null, fence=fence+1, lease_until=now(), updated_at=now(),
              summary='Установка восстановлена из копии. Требуется проверка администратора'
            WHERE status IN ('QUEUED','RUNNING','NEEDS_ATTENTION') RETURNING id)
            INSERT INTO installation.audit(job_id,stage,summary)
              SELECT id,'RESTORED','Старое задание ограждено после восстановления' FROM fenced;
            UPDATE installation.state SET operator_seen_at=null;""")
    has_inbox=(source/'max-inbox.sqlite').is_file()
    if has_inbox:
        apply([{'apiVersion':'v1','kind':'PersistentVolumeClaim','metadata':{'name':'max-inbox','namespace':NS},
                'spec':{'accessModes':['ReadWriteOnce'],'resources':{'requests':{'storage':'1Gi'}}}}])
    # Mount the actual blob PVC in a short-lived utility pod, without starting the API.
    apply([{'apiVersion':'v1','kind':'Pod','metadata':{'name':'blob-restore','namespace':NS},'spec':{
        'restartPolicy':'Never', 'automountServiceAccountToken':False,
        'containers':[{'name':'restore','image':'postgres:16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139','command':['sleep','900'],
                       'resources':{'requests':{'cpu':'10m','memory':'32Mi'},'limits':{'cpu':'100m','memory':'128Mi'}},
                       'volumeMounts':[{'name':'blobs','mountPath':'/data/blobs'}]+([{'name':'inbox','mountPath':'/data/max-inbox'}] if has_inbox else [])}],
        'volumes':[{'name':'blobs','persistentVolumeClaim':{'claimName':'lecturer-blobs'}}]+([{'name':'inbox','persistentVolumeClaim':{'claimName':'max-inbox'}}] if has_inbox else [])}}])
    kc('-n', NS, 'wait', '--for=condition=Ready', 'pod/blob-restore', '--timeout=120s')
    try:
        stream_exec(['blob-restore', '--', 'tar', '-xzf', '-', '-C', '/data'], source/'blobs.tar.gz', restore=True)
        if has_inbox:
            stream_exec(['blob-restore','--','sh','-ec',
                         'cat > /data/max-inbox/inbox.sqlite; chown 1000:1000 /data/max-inbox/inbox.sqlite; chmod 600 /data/max-inbox/inbox.sqlite'],
                        source/'max-inbox.sqlite',restore=True)
    finally:
        kc('-n', NS, 'delete', 'pod/blob-restore', '--wait=true')
    print('Data restored; start the controller to resume the application.')


def operator_config():
    config, values = read('site.json'), read('secrets.json')
    updates = config.get('updates')
    if not updates: return None
    atomic(STATE/'release.pub.pem', updates['publicKey'])
    bindings = {key: [] for key in IMAGE_KEYS}
    for name, component in [('core','core'), ('content-worker','core'), ('web','web'), ('edge','web'),
         ('authority','authority'), ('converter','converter'), ('realtime','services'),
         ('event-publisher','services'), ('analytics','services'), ('media-control','services'),
         ('max-adapter','max-adapter'), ('sfu','sfu')]:
        bindings[component].append({'resource':('daemonset/' if name=='sfu' else 'deployment/')+name, 'container':name})
    result = {'kind':'kubernetes', 'backend':'appliance', 'namespace':NS, 'repo':str(ROOT),
              'kubeconfig':str(KUBE), 'imagesFile':str(STATE/'images.json'), 'stateDir':str(STATE/'operator'),
              'apiUrl':'http://k3s:30080', 'healthUrl':'http://k3s:30080/health',
              'operatorKey':values['INSTALLATION_OPERATOR_KEY'], 'catalogUrl':updates['catalogUrl'],
              'publicKey':str(STATE/'release.pub.pem'), 'bindings':bindings}
    atomic(STATE/'operator.json', json.dumps(result))
    return STATE/'operator.json'


def reconcile():
    connect(); bootstrap()
    config = operator_config()
    if not config:
        print('No signed update channel configured. Application remains available.', flush=True)
        while True: time.sleep(30)
    # NodePort stays private to the Docker network. Unlike port-forward, its lifetime
    # is independent of the API pod which this operator is about to replace.
    os.execv(sys.executable, [sys.executable, str(ROOT/'deploy/updates/installation_operator.py'), '--config', str(config)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init','reconcile','backup','backup-loop','restore','status','admin'])
    parser.add_argument('--backup')
    parser.add_argument('--recovery-key')
    args = parser.parse_args()
    if args.command == 'init': init(); return
    connect()
    if args.command == 'backup-loop':
        from backup_schedule import loop
        from operational_metrics import collect
        loop(raw_backup,STATE,BACKUPS,lambda:collect(kc,sql))
    elif args.command == 'backup': backup()
    elif args.command == 'restore':
        if args.backup and args.backup.endswith('.cms'):
            if not args.recovery_key: raise RuntimeError('Encrypted recovery requires an offline recovery key')
            from backup_schedule import decrypt
            with tempfile.TemporaryDirectory(prefix='recovery-',dir=STATE) as stage:
                directory=decrypt(args.backup,Path(stage)/'data',args.recovery_key,STATE/'backup-recipient.pem')
                restore(directory)
        else: restore(args.backup)
    elif args.command == 'status':
        sys.stdout.buffer.write(kc('-n', NS, 'get', 'pods,hpa,scaledobjects,pvc'))
    elif args.command == 'admin':
        print(read('secrets.json')['ADMIN_SETUP_TOKEN'])
    else: reconcile()


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('appliance: '+str(error), file=sys.stderr)
        sys.exit(1)
