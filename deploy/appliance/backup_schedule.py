"""Encrypted backup publication and bounded retention; private recovery key stays off the VM."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def encrypt(source, destination, recipient):
    source, destination, recipient=Path(source),Path(destination),Path(recipient)
    if not recipient.is_file(): raise RuntimeError('Configure backup-recipient.pem; keep its private recovery key off this VM')
    archive=subprocess.Popen(['tar','-czf','-','-C',str(source),'.'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    try:
        result=subprocess.run(['openssl','cms','-encrypt','-binary','-stream','-aes-256-gcm','-outform','DER',
                               '-out',str(destination),str(recipient)],stdin=archive.stdout,stderr=subprocess.PIPE,timeout=1800)
        archive.stdout.close()
        if archive.wait(timeout=30)!=0 or result.returncode!=0: raise RuntimeError('Encrypted backup stream failed')
    finally:
        if archive.poll() is None: archive.kill();archive.wait()


def publish(create_backup, state, destination):
    state,destination=Path(state),Path(destination)
    os.umask(0o077)
    config=json.loads((state/'site.json').read_text()).get('backups',{})
    if not config.get('owner') or not config.get('offVmConfirmed'):
        raise RuntimeError('Backups need an accountable owner and a confirmed off-VM destination in site.json')
    recipient=state/'backup-recipient.pem'
    if not recipient.is_file(): raise RuntimeError('Missing backup-recipient.pem')
    destination.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (state/'backup.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix='backup-',dir=state) as scratch:
            raw=create_backup(Path(scratch))
            required=int(sum(p.stat().st_size for p in raw.iterdir())*1.05)+2*1024**3
            if shutil.disk_usage(destination).free < required:
                raise RuntimeError('Not enough free space on the external backup destination')
            final=destination/(raw.name+'.cms')
            partial=destination/('.'+raw.name+'.partial')
            try:
                encrypt(raw,partial,recipient)
                digest=hashlib.file_digest(partial.open('rb'),'sha256').hexdigest()
                partial.rename(final)
                (destination/(final.name+'.sha256')).write_text(digest+'\n')
                now=time.time()
                (state/'backup-status.json').write_text(json.dumps({'success':now,'lastAttempt':now,'ok':True}))
                # Retain at least two completed recovery points even if both are old.
                retained=sorted(destination.glob('*.cms'),key=lambda p:p.stat().st_mtime,reverse=True)
                for old in retained[2:]:
                    if old.stat().st_mtime < now-86400*max(2,int(config.get('retentionDays',14))):
                        old.unlink();(destination/(old.name+'.sha256')).unlink(missing_ok=True)
                return final
            finally: partial.unlink(missing_ok=True)


def loop(create_backup,state,destination,collect=None):
    from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
    import threading
    state=Path(state)
    metrics={'text':'','ok':False}
    def observe():
        while True:
            try: metrics.update(text=collect() if collect else '',ok=True)
            except Exception: metrics['ok']=False
            time.sleep(15)
    threading.Thread(target=observe,daemon=True).start()
    class Metrics(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path!='/metrics':self.send_error(404);return
            try: status=json.loads((state/'backup-status.json').read_text())
            except (OSError,ValueError):status={}
            free=shutil.disk_usage(destination).free
            body=(f'lecturer_backup_last_success_seconds {status.get("success",0)}\n'
                  f'lecturer_backup_ok {int(status.get("ok",False))}\n'
                  f'lecturer_backup_destination_free_bytes {free}\n' + f'lecturer_operations_collector_up {int(metrics["ok"])}\n'+metrics['text']).encode()
            self.send_response(200);self.send_header('Content-Type','text/plain; version=0.0.4');self.end_headers();self.wfile.write(body)
    server=ThreadingHTTPServer(('0.0.0.0',8097),Metrics)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    while True:
        try: previous=json.loads((state/'backup-status.json').read_text())
        except (OSError,ValueError):previous={}
        config=json.loads((state/'site.json').read_text()).get('backups',{})
        interval=max(3600,min(86400,int(config.get('intervalSeconds',86400))))
        if time.time()-previous.get('success',0)>=interval:
            try: publish(create_backup,state,destination)
            except Exception as error:
                previous.update(ok=False,lastAttempt=time.time())
                (state/'backup-status.json').write_text(json.dumps(previous))
                print('backup: '+str(error),flush=True)
                time.sleep(60+os.urandom(1)[0]);continue
        time.sleep(30)


def decrypt(archive, destination, key, recipient):
    """Decrypt only into a new private staging directory; verify AEAD before extraction."""
    import tarfile
    destination=Path(destination)
    destination.mkdir(mode=0o700,parents=True,exist_ok=False)
    try:
        with tempfile.TemporaryFile() as plaintext:
            subprocess.run(['openssl','cms','-decrypt','-binary','-inform','DER','-in',str(archive),
                            '-recip',str(recipient),'-inkey',str(key)],stdout=plaintext,stderr=subprocess.PIPE,check=True,timeout=1800)
            plaintext.seek(0)
            with tarfile.open(fileobj=plaintext,mode='r:gz') as tar:
                members=tar.getmembers()
                if len(members)>16 or sum(m.size for m in members)>40*1024**3:
                    raise RuntimeError('Recovery archive exceeds budget')
                for member in members:
                    name=member.name.removeprefix('./')
                    if name in ['', '.'] and member.isdir():continue
                    if not member.isfile() or '/' in name or name in ['','..']:
                        raise RuntimeError('Unsafe recovery archive')
                    with tar.extractfile(member) as source,(destination/name).open('xb') as output:
                        shutil.copyfileobj(source,output)
    except Exception:
        shutil.rmtree(destination)
        raise
    return destination
