import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('backup_schedule',Path(__file__).with_name('backup_schedule.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

class EncryptedRecoveryTest(unittest.TestCase):
    def test_encrypted_round_trip_and_tamper_fail_before_extraction(self):
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw);key=root/'key';cert=root/'cert';source=root/'source';source.mkdir();(source/'data').write_bytes(b'private recovery fixture')
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=fixture','-days','1',
                            '-keyout',str(key),'-out',str(cert)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            encrypted=root/'copy.cms';b.encrypt(source,encrypted,cert)
            self.assertNotIn(b'private recovery fixture',encrypted.read_bytes())
            b.decrypt(encrypted,root/'restored',key,cert)
            self.assertEqual((source/'data').read_bytes(),(root/'restored/data').read_bytes())
            damaged=bytearray(encrypted.read_bytes());damaged[-40]^=1;encrypted.write_bytes(damaged)
            with self.assertRaises(Exception):b.decrypt(encrypted,root/'bad',key,cert)
            self.assertFalse((root/'bad').exists())

    def test_unconfigured_external_backup_fails_without_creating_plaintext(self):
        import json
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw);(root/'site.json').write_text(json.dumps({}))
            with self.assertRaisesRegex(RuntimeError,'owner'):
                b.publish(lambda p:self.fail('plaintext created before configuration'),root,root/'backups')
