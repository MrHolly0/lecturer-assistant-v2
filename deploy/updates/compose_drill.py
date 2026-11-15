#!/usr/bin/env python3
"""Isolated real Compose update, additive migration and backup restore drill. Never uses the main stand."""
import argparse
import base64
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import uuid
import zipfile

spec = importlib.util.spec_from_file_location('update_operator', Path(__file__).with_name('installation_operator.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


def port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


def run_drill(jar, output):
    root = Path(__file__).resolve().parents[2]
    work = Path(tempfile.mkdtemp(prefix='lecturer-update-drill-'))
    os.chmod(work, 0o700)
    project = 'lecturer-update-drill-' + uuid.uuid4().hex[:10]
    registry_name = project + '-registry'
    registry_port, app_port = port(), port()
    registry = f'127.0.0.1:{registry_port}'
    log_path = work/'drill.log'
    log = log_path.open('w');os.chmod(log_path, 0o600)
    image_tags = []
    compose = ['docker','compose','-p',project,'-f',str(work/'docker-compose.yml'),'-f',str(work/'docker-compose.prod.yml')]
    def cmd(argv):
        result = subprocess.run(argv, cwd=work, stdout=log, stderr=subprocess.STDOUT, timeout=600)
        if result.returncode: raise RuntimeError('Drill command failed; private log: '+str(log_path))
    def capture(argv):
        return subprocess.check_output(argv,cwd=work,timeout=60,text=True).strip()
    def request(path, body=None, token=None):
        headers = {'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        req=urllib.request.Request(f'http://127.0.0.1:{app_port}'+path,
            data=json.dumps(body).encode() if body is not None else None,headers=headers)
        with urllib.request.urlopen(req,timeout=10) as response:
            data=response.read();return json.loads(data) if data else None
    try:
        for directory in ['blobs','backups','build','deploy/cloud','deploy/stand/backup']:
            (work/directory).mkdir(parents=True,exist_ok=True)
        for file in ['deploy/cloud/lecturer.sh','deploy/stand/backup/create-pair.sh']:
            shutil.copy2(root/file,work/file)
        (work/'blobs/slide.txt').write_text('Existing presentation data retained across update.\n')
        signing, public = work/'signing.pem',work/'public.pem'
        cmd(['openssl','genpkey','-algorithm','ED25519','-out',str(signing)])
        cmd(['openssl','pkey','-in',str(signing),'-pubout','-out',str(public)])
        public_der=subprocess.check_output(['openssl','pkey','-pubin','-in',str(public),'-outform','DER'])
        credential, password, setup, jwt = [secrets.token_hex(32) for _ in range(4)]
        cmd(['docker','run','-d','--name',registry_name,'-p',f'127.0.0.1:{registry_port}:5000','registry:2'])
        for name in ['bootstrap','candidate']:
            target=work/'build/app.jar';shutil.copy2(jar,target)
            if name=='candidate':
                # Deliberately additive, synthetic migration confined to this lab image.
                with zipfile.ZipFile(target,'a') as archive:
                    archive.writestr('BOOT-INF/classes/db/migration/V54__isolated_update_drill.sql',
                        'CREATE TABLE installation.update_drill_marker(id integer primary key);\n'
                        'INSERT INTO installation.update_drill_marker VALUES (1);\n')
            (work/'build/Dockerfile').write_text('FROM eclipse-temurin:21-jre\nCOPY app.jar /app/app.jar\nENTRYPOINT ["java","-jar","/app/app.jar"]\n')
            tag=f'{registry}/core:{name}';image_tags.append(tag)
            cmd(['docker','build','-t',tag,str(work/'build')]);cmd(['docker','push',tag])
        web=f'{registry}/web:candidate';image_tags.append(web)
        cmd(['docker','tag','nginx:1.27-alpine',web]);cmd(['docker','push',web])
        digests={}
        for name, tag in [('bootstrap',image_tags[0]),('candidate',image_tags[1]),('web',web)]:
            repository, version=tag[len(registry)+1:].rsplit(':',1)
            req=urllib.request.Request(f'http://{registry}/v2/{repository}/manifests/{version}', method='HEAD',
                headers={'Accept': 'application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'})
            with urllib.request.urlopen(req,timeout=10) as response:
                digest=response.headers['Docker-Content-Digest']
            assert digest and digest.startswith('sha256:')
            digests[name]=registry+'/'+repository+'@'+digest
        config={'kind':'compose','repo':str(work),'stateDir':str(work/'state'),'publicKey':str(public),
                'apiUrl':f'http://127.0.0.1:{app_port}','operatorKey':credential,
                'healthUrl':f'http://127.0.0.1:{app_port}/health','project':project,
                'composeFiles':['docker-compose.yml','docker-compose.prod.yml'],
                'bindings':{'core':['core'],'web':['web']},'minFreeBytes':0}
        env={'DB_URL':'jdbc:postgresql://postgres:5432/lecturer','DB_USERNAME':'lecturer','DB_PASSWORD':password,
             'JWT_SECRET':jwt,'ADMIN_SETUP_TOKEN':setup,'INSTALLATION_UPDATES_ENABLED':'true',
             'INSTALLATION_OPERATOR_KEY':credential,'INSTALLATION_RELEASE_PUBLIC_KEY':base64.b64encode(public_der).decode(),
             'JAVA_TOOL_OPTIONS':'-Xmx320m -XX:ActiveProcessorCount=2','BLOB_ROOT':'/data/blobs'}
        (work/'edge.conf').write_text('server { listen 80; resolver 127.0.0.11 valid=1s ipv6=off; set $application core:8080;\nlocation /api/ { proxy_pass http://$application; }\nlocation = /health { proxy_pass http://$application/actuator/health; }\nlocation /internal/ { return 404; }\nlocation / { return 404; }\n}\n')
        services={
          'postgres':{'image':'postgres:16-alpine','environment':{'POSTGRES_USER':'lecturer','POSTGRES_PASSWORD':password,'POSTGRES_DB':'lecturer'},
            'volumes':['database:/var/lib/postgresql/data',str(work/'backups')+':/backups:ro'],
            'healthcheck':{'test':['CMD','pg_isready','-U','lecturer'],'interval':'2s','timeout':'2s','retries':30}},
          'core':{'image':digests['bootstrap'],'environment':env,'mem_limit':'512m',
            'volumes':[str(work/'blobs')+':/data/blobs'],
            'depends_on':{'postgres':{'condition':'service_healthy'}},
            'healthcheck':{'test':['CMD','curl','-fsS','http://127.0.0.1:8080/actuator/health'],
                           'interval':'2s','timeout':'2s','retries':60,'start_period':'10s'}},
          'web':{'image':digests['web']},
          'edge':{'image':'nginx:1.27-alpine','ports':[f'127.0.0.1:{app_port}:80'],
            'volumes':[str(work/'edge.conf')+':/etc/nginx/conf.d/default.conf:ro'],
            'depends_on':{'core':{'condition':'service_healthy'}},
            'healthcheck':{'test':['CMD','wget','-q','-O','-','http://127.0.0.1/health'],
                           'interval':'2s','timeout':'2s','retries':30}},
          'db-backup':{'image':'postgres:16-alpine','entrypoint':['sh','-c','while true; do sleep 3600; done'],
             'environment':{'PGHOST':'postgres','PGDATABASE':'lecturer','PGUSER':'lecturer','PGPASSWORD':password,
                 'BACKUP_DESTINATION':'/backups','BACKUP_SOURCE_PROJECT':project,'BLOB_SOURCE':'/blob-source',
                 'BACKUP_KEEP_DAYS':'14','BACKUP_LOCK_WAIT_SECONDS':'30'},
             'volumes':[str(work/'backups')+':/backups',str(work/'blobs')+':/blob-source:ro',
                        str(work/'deploy/stand/backup/create-pair.sh')+':/usr/local/bin/create-pair.sh:ro']}}
        operator.atomic_json(work/'docker-compose.yml',{'services':services,'volumes':{'database':{}}})
        operator.atomic_json(work/'docker-compose.prod.yml',{'services':{}})
        (work/'.env').write_text('PUBLIC_MODE=domain\nSITE_DOMAIN=localhost\nJWT_SECRET='+jwt+'\n')
        os.chmod(work/'.env',0o600)
        cmd(compose+['up','-d','--wait','--wait-timeout','120'])
        req=urllib.request.Request(f'http://127.0.0.1:{app_port}/api/v1/auth/bootstrap-admin',
            data=json.dumps({'displayName':'Drill Administrator','email':'drill@example.test','password':'isolated-drill-password'}).encode(),
            headers={'Content-Type':'application/json','X-Admin-Setup-Token':setup})
        with urllib.request.urlopen(req,timeout=10) as response:token=json.load(response)['accessToken']
        course=request('/api/v1/courses',{'title':'Existing course survives update'},token)
        release={'id':'isolated-drill','version':'drill-only','notes':'Synthetic local update acceptance',
                 'commit':'a'*40,'databaseMin':53,'databaseMax':53,'backwardCompatible':True,
                 'images':{'core':digests['candidate'],'web':digests['web']}}
        payload=json.dumps({'schema':1,'expiresAt':(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).isoformat(),
                            'releases':[release]},separators=(',',':'))
        (work/'catalog').write_text(payload)
        cmd(['openssl','pkeyutl','-sign','-inkey',str(signing),'-rawin','-in',str(work/'catalog'),'-out',str(work/'signature')])
        envelope={'payload':payload,'signature':base64.b64encode((work/'signature').read_bytes()).decode()}
        api=operator.Api(config);api.post('/catalog',{'kind':'compose',**envelope})
        req=urllib.request.Request(f'http://127.0.0.1:{app_port}/api/v1/admin/installation/jobs',
            data=json.dumps({'releaseId':'isolated-drill'}).encode(),
            headers={'Content-Type':'application/json','Authorization':'Bearer '+token,'Idempotency-Key':str(uuid.uuid4())})
        with urllib.request.urlopen(req,timeout=10) as response:job=json.load(response)
        worker=operator.Worker(config,api=api)
        assignment=api.post('/claim',{'owner':worker.owner});worker.execute(assignment)
        state=request('/api/v1/admin/installation',token=token)
        assert state['jobs'][0]['id']==job['id'] and state['jobs'][0]['status']=='SUCCEEDED'
        assert state['databaseVersion']==54
        assert request('/api/v1/courses/'+course['id'],token=token)['title']==course['title']
        assert (work/'blobs/slide.txt').read_text()=='Existing presentation data retained across update.\n'
        pairs=list((work/'backups').glob('pair-*'));assert len(pairs)==1
        with tarfile.open(pairs[0]/'blob-data.tar.gz') as archive:
            assert archive.extractfile('./slide.txt').read()==(work/'blobs/slide.txt').read_bytes()
        cmd(compose+['exec','-T','postgres','createdb','-U','lecturer','restored_drill'])
        cmd(compose+['exec','-T','postgres','pg_restore','-U','lecturer','-d','restored_drill',
                     '/backups/'+pairs[0].name+'/database.dump'])
        restored=capture(compose+['exec','-T','postgres','psql','-U','lecturer','-d','restored_drill','-Atc',
                                  'select count(*) from org.courses'])
        assert restored=='1'
        report={'result':'PASS','project':project,'jobStatus':'SUCCEEDED','databaseBefore':53,'databaseAfter':54,
                'existingCoursePreserved':True,'blobPreserved':True,'backupRestored':True,
                'runningImageDigestsVerified':True,'publicProxyOperatorPrefix':True,'syntheticMigrationOnly':True,
                'limits':'Single-Mac isolated Compose acceptance, not a production rollout or Kubernetes upgrade drill.'}
        Path(output).write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report))
    finally:
        if (work/'docker-compose.yml').exists():
            subprocess.run(compose+['down','--volumes','--remove-orphans'],cwd=work,stdout=log,stderr=subprocess.STDOUT,timeout=120)
        subprocess.run(['docker','rm','-f',registry_name],stdout=log,stderr=subprocess.STDOUT,timeout=30)
        if image_tags:subprocess.run(['docker','image','rm',*image_tags],stdout=log,stderr=subprocess.STDOUT,timeout=30)
        log.close()
        print('Private drill directory:',work)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core-jar',required=True)
    parser.add_argument('--report',required=True)
    args=parser.parse_args()
    run_drill(Path(args.core_jar).resolve(),args.report)
