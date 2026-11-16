import importlib.util
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).parent))
spec=importlib.util.spec_from_file_location('appliance_control',Path(__file__).with_name('control.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.state=Path(self.temp.name)
        self.config=json.loads(Path(__file__).with_name('site.example.json').read_text())
        self.images={key:'example.test/'+key+'@sha256:'+'a'*64 for key in c.IMAGE_KEYS}
        for name,value in [('site.json',self.config),('images.json',self.images)]:
            (self.state/name).write_text(json.dumps(value))
        self.scope=patch.object(c,'STATE',self.state);self.scope.start();self.addCleanup(self.scope.stop)

    def test_init_is_private_and_refuses_rekey(self):
        c.init()
        first=(self.state/'secrets.json').read_bytes()
        self.assertEqual(0o600,(self.state/'secrets.json').stat().st_mode&0o777)
        self.assertEqual(0o600,(self.state/'registries.yaml').stat().st_mode&0o777)
        with self.assertRaisesRegex(RuntimeError,'Already initialized'):c.init()
        self.assertEqual(first,(self.state/'secrets.json').read_bytes())
        self.assertNotIn('MAX_BOT_TOKEN',json.loads(first))

    def test_restore_rejects_corrupt_backup_before_touching_credentials(self):
        c.init();original=(self.state/'secrets.json').read_bytes()
        source=self.state/'backup';source.mkdir()
        names={'lecturer.dump','analytics.dump','blobs.tar.gz','site.json','images.json','secrets.json','database-version'}
        for name in names:(source/name).write_text('corrupt')
        (source/'checksums.json').write_text(json.dumps({name:'0'*64 for name in names}))
        with patch.object(c,'kc') as kube:
            with self.assertRaisesRegex(RuntimeError,'checksum'):c.restore(source)
            kube.assert_not_called()
        self.assertEqual(original,(self.state/'secrets.json').read_bytes())

    def test_installed_config_change_never_reapplies_workloads(self):
        c.init()
        (self.state/'installed.json').write_text(json.dumps({'cluster':'cluster-1','config':'old'}))
        with patch.object(c,'kc',return_value=json.dumps({'metadata':{'uid':'cluster-1'}}).encode()),patch.object(c,'base') as base:
            with self.assertRaisesRegex(RuntimeError,'configuration changed'):c.bootstrap()
            base.assert_not_called()

    def test_status_and_backup_can_replace_kubeconfig_concurrently(self):
        path=self.state/'kubeconfig.json'
        def write(number):c.atomic(path,json.dumps({'writer':number,'value':'x'*1024}))
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(write,range(80)))
        value=json.loads(path.read_text())
        self.assertEqual('x'*1024,value['value'])
        self.assertEqual(0o600,path.stat().st_mode&0o777)
        self.assertFalse(list(self.state.glob('.kubeconfig*')))


if __name__=='__main__':unittest.main()
