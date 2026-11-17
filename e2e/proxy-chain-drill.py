#!/usr/bin/env python3
"""Disposable Caddy -> real K3s NodePort -> nginx -> fixture API ingress checks.

Uses no application databases or messenger credentials. Requires Docker and ~2 GiB spare RAM.
The two client containers have no route to the private backend network.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import secrets
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
K3S = 'rancher/k3s:v1.35.10-k3s1@sha256:8262ca99a558dca0c0437443421986480b2359f9118f2371359f88a41514522f'
CADDY = 'caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0'
NGINX = 'nginx:1.30.6-alpine@sha256:901e593c95dc85f5a729f5765516321366ef4ac401821431d408897e95287d0a'
if platform.machine() in ['arm64', 'aarch64']:
    NGINX = 'nginx@sha256:564a09935b00f058ca1b28c742169ba817499baa0479807bf7f373fe2804fbf7'
PAUSE = 'rancher/mirrored-pause:3.10.2'
NODE = 'node:24-alpine'


def run(args, *, data=None, timeout=180):
    result = subprocess.run(args, input=data, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Command failed: ' + ' '.join(args[:4]) + '\n' + result.stderr[-1600:])
    return result.stdout


def drill(output, pull=False):
    os.umask(0o077)
    if pull:
        for image in [K3S, CADDY, NGINX, PAUSE, NODE]:
            run(['docker', 'pull', image], timeout=300)
    suffix = secrets.token_hex(4)
    project = 'lecturer-proxy-check-' + suffix
    tag = 'lecturer-proxy-check-nginx:' + suffix
    with tempfile.TemporaryDirectory(prefix='lecturer-proxy-check-') as raw:
        stage = Path(raw)
        spec = importlib.util.spec_from_file_location('proxy_render', ROOT/'deploy/appliance/render.py')
        renderer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(renderer)
        key = secrets.token_hex(32)
        site = {'publicOrigin': 'https://fixture.invalid', 'tlsMode': 'proxy', 'trustedProxyCidrs': []}
        (stage/'Caddyfile').write_text(renderer.front_proxy(site, {'TRUSTED_PROXY_KEY': key}))
        (stage/'api.mjs').write_text("""
import {createServer} from 'node:http';
import {clientAddress} from '/source/services/common/client-address.mjs';
createServer(async(req,res)=>{for await(const chunk of req){};
res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({source:clientAddress(req),runtime:process.version}));
}).listen(8080,'0.0.0.0');
""")
        compose = {'services': {
            'k3s': {'image': K3S, 'privileged': True, 'mem_limit': '1536m', 'cpus': 2,
                    'tmpfs': ['/run', '/var/run'], 'volumes': ['cluster:/var/lib/rancher/k3s'],
                    'entrypoint': ['sh', '-ec', 'exec /bin/k3s server --node-ip="$(hostname -i | awk \'{print $1}\')" --flannel-iface=eth0 "$@"', '--'],
                    'command': ['--disable=traefik,servicelb,coredns,metrics-server,local-storage',
                                '--pause-image='+PAUSE], 'networks': ['back']},
            'front': {'image': CADDY, 'mem_limit': '96m', 'cpus': 0.5,
                      'environment': {'GOMEMLIMIT': '48MiB'},
                      'volumes': [str(stage/'Caddyfile')+':/etc/caddy/Caddyfile:ro'], 'networks': ['front', 'back']},
            'api': {'image': NODE, 'mem_limit': '128m', 'cpus': 0.5,
                    'command': ['node', '/fixture/api.mjs'], 'environment': {'TRUSTED_PROXY_KEY': key},
                    'volumes': [str(stage)+':/fixture:ro', str(ROOT)+':/source:ro'], 'networks': ['back']},
            **{name: {'image': NODE, 'mem_limit': '64m', 'cpus': 0.5,
                      'command': ['node', '-e', 'setInterval(()=>{},3600000)'], 'networks': ['front']}
               for name in ['client-a', 'client-b']}},
            'networks': {'front': {'internal': True}, 'back': {'internal': True}}, 'volumes': {'cluster': {}}}
        manifest = stage/'compose.json'
        manifest.write_text(json.dumps(compose))
        base = ['docker', 'compose', '-p', project, '-f', str(manifest)]
        def dc(*args, **kwargs): return run(base+list(args), **kwargs)
        def kube(*args, **kwargs): return dc('exec', '-T', 'k3s', 'kubectl', *args, **kwargs)
        def address(service, network):
            name = dc('ps', '-q', service).strip()
            details = json.loads(run(['docker', 'inspect', name]))[0]
            return details['NetworkSettings']['Networks'][project+'_'+network]['IPAddress']
        def client(name, script):
            return json.loads(dc('exec', '-T', name, 'node', '--input-type=module', '-e', script, timeout=45))
        try:
            dc('up', '-d', '--pull', 'never', timeout=120)
            for attempt in range(90):
                try:
                    kube('get', '--raw=/readyz', timeout=10)
                    break
                except (RuntimeError, subprocess.TimeoutExpired):
                    if attempt == 89: raise
                    time.sleep(1)
            kube('wait', '--for=create', 'serviceaccount/default', '--timeout=90s', timeout=100)
            run(['docker', 'tag', NGINX, tag])
            producer = subprocess.Popen(['docker', 'save', tag, PAUSE], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            try:
                loaded = subprocess.run(base+['exec', '-T', 'k3s', 'ctr', 'images', 'import', '-'],
                                        stdin=producer.stdout, capture_output=True, timeout=90)
                producer.stdout.close()
                if loaded.returncode or producer.wait(timeout=15): raise RuntimeError('Fixture images could not be imported')
            finally:
                if producer.poll() is None: producer.kill(); producer.wait()
            kube('wait', '--for=condition=Ready', 'nodes', '--all', '--timeout=120s', timeout=130)
            api = address('api', 'back')
            edge = (ROOT/'deploy/scalable/edge.nginx.conf').read_text()
            edge = re.sub(r'server [^;\n]+;', 'server '+api+':8080;', edge)
            edge = edge.replace('limit_req zone=password_open', 'add_header X-Fixture-Peer $remote_addr always;\n        limit_req zone=password_open')
            config = {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': {'name': 'edge-check'},
                      'data': {'edge.conf': edge, 'main.template': (ROOT/'deploy/scalable/edge-main.nginx.template').read_text()}}
            pod = {'apiVersion': 'v1', 'kind': 'Pod', 'metadata': {'name': 'edge-check', 'labels': {'app': 'edge-check'}},
                   'spec': {'automountServiceAccountToken': False, 'containers': [{
                       'name': 'nginx', 'image': tag, 'imagePullPolicy': 'Never',
                       'command': ['sh', '-ec', "envsubst '$TRUSTED_PROXY_KEY' < /config/main.template > /tmp/nginx.conf; exec nginx -c /tmp/nginx.conf -g 'daemon off;'"] ,
                       'env': [{'name': 'TRUSTED_PROXY_KEY', 'value': key}],
                       'resources': {'requests': {'cpu': '50m', 'memory': '32Mi'}, 'limits': {'cpu': '1', 'memory': '64Mi'}},
                       'readinessProbe': {'httpGet': {'path': '/edge-health', 'port': 8088}, 'periodSeconds': 1},
                       'securityContext': {'runAsUser': 101, 'runAsGroup': 101, 'allowPrivilegeEscalation': False},
                       'volumeMounts': [{'name': 'config', 'mountPath': '/config'},
                                        {'name': 'config', 'mountPath': '/etc/nginx/conf.d/default.conf', 'subPath': 'edge.conf'}]}],
                       'volumes': [{'name': 'config', 'configMap': {'name': 'edge-check'}}]}}
            service = {'apiVersion': 'v1', 'kind': 'Service', 'metadata': {'name': 'edge-check'},
                       'spec': {'type': 'NodePort', 'selector': {'app': 'edge-check'},
                                'ports': [{'port': 8088, 'targetPort': 8088, 'nodePort': 30080}]}}
            kube('apply', '-f', '-', data=json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': [config, pod, service]}))
            kube('wait', '--for=condition=Ready', 'pod/edge-check', '--timeout=120s', timeout=130)
            for attempt in range(30):
                status = client('client-a', "try{console.log((await fetch('http://front/edge-health',{signal:AbortSignal.timeout(2000)})).status)}catch{console.log(0)}")
                if status == 200: break
                if attempt == 29: raise RuntimeError('Private NodePort did not become reachable through Caddy')
                time.sleep(0.5)
            request = "const r=await fetch('http://front/api/v1/auth/login',{method:'POST',headers:{'x-forwarded-for':'198.51.100.99','x-lecturer-client-ip':'198.51.100.99','x-lecturer-proxy-key':'forged'}});console.log(JSON.stringify({status:r.status,peer:r.headers.get('x-fixture-peer'),...await r.json()}));"
            a, b = client('client-a', request), client('client-b', request)
            assert a['status'] == b['status'] == 200
            assert a['source'] == address('client-a', 'front') and b['source'] == address('client-b', 'front')
            assert a['peer'] == b['peer'] and a['peer'] not in [a['source'], b['source']]
            flood = client('client-a', "const r=await Promise.all(Array.from({length:140},()=>fetch('http://front/api/v1/auth/login',{method:'POST'}).then(r=>r.status)));console.log(JSON.stringify({rejected:r.filter(x=>x===429).length}));")
            assert flood['rejected'] > 0
            independent = client('client-b', "const r=await Promise.all(Array.from({length:10},()=>fetch('http://front/api/v1/auth/login',{method:'POST'}).then(r=>r.status)));console.log(JSON.stringify(r));")
            assert independent == [200]*10
            time.sleep(6)
            nat = client('client-b', "const r=await Promise.all(Array.from({length:100},(_,i)=>fetch('http://front/api/v1/auth/login',{method:'POST',body:JSON.stringify({email:'fixture-'+i})}).then(r=>r.status)));console.log(JSON.stringify({accepted:r.filter(x=>x===200).length}));")
            assert nat['accepted'] == 100
            private = address('k3s', 'back')
            bypass = client('client-a', f"let blocked=false;try{{await fetch('http://{private}:30080/api/v1/auth/login',{{signal:AbortSignal.timeout(700)}});}}catch{{blocked=true;}}console.log(JSON.stringify({{blocked}}));")
            assert bypass['blocked']
            site['trustedProxyCidrs'] = [address('client-a', 'front')+'/32']
            (stage/'Caddyfile').write_text(renderer.front_proxy(site, {'TRUSTED_PROXY_KEY': key}))
            dc('exec', '-T', 'front', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile')
            chain = client('client-a', "const r=await fetch('http://front/api/v1/system/info',{headers:{'x-forwarded-for':'192.0.2.99, 198.51.100.12'}});console.log(JSON.stringify(await r.json()));")
            assert chain['source'] == '198.51.100.12'
            untrusted = client('client-b', "const r=await fetch('http://front/api/v1/system/info',{headers:{'x-forwarded-for':'192.0.2.99, 198.51.100.12'}});console.log(JSON.stringify(await r.json()));")
            assert untrusted['source'] == b['source']
            result = {'passed': True, 'transport': 'Caddy -> K3s NodePort (Cluster/SNAT) -> nginx -> fixture API',
                      'distinctSources': True, 'snatObserved': True, 'spoofedHeadersIgnored': True, 'source429': flood['rejected'],
                      'independentAccepted': len(independent), 'sameNatBurstAccepted': nat['accepted'],
                      'privateBackendBypassBlocked': True, 'explicitUpstreamTrustChecked': True,
                      'node': a['runtime'], 'scope': 'Ingress isolation; not password CPU or 10000-user capacity qualification'}
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(result, indent=2)+'\n')
            print(json.dumps(result))
        except Exception:
            diagnostics = dc('logs', '--no-color', '--tail=30', 'k3s')
            failures = [line for line in diagnostics.splitlines() if re.search(r'level=(fatal|error)|Error:|flag provided', line)]
            failures.append(dc('logs', '--no-color', '--tail=20', 'front', 'api'))
            try: failures.append(kube('logs', 'edge-check', '--tail=20'))
            except RuntimeError: pass
            output.with_suffix('.errors.log').write_text('\n'.join(failures)+'\n')
            raise
        finally:
            dc('down', '-v', '--remove-orphans', timeout=90)
            subprocess.run(['docker', 'image', 'rm', tag], capture_output=True, check=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'artifacts/proxy-chain-check.json')
    parser.add_argument('--pull', action='store_true', help='Fetch fixture images before the isolated check')
    args = parser.parse_args()
    drill(args.output, args.pull)
