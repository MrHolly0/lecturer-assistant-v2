import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

class ReleaseCompatibilityTest(unittest.TestCase):
    def test_old_topology_cannot_receive_an_image_only_catalog(self):
        script=Path(__file__).with_name('release.py')
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw);source=root/'images';source.mkdir()
            for name in ['core','services','sfu','web','authority','converter','max-adapter','controller']:
                (source/(name+'.json')).write_text(json.dumps({name:'registry.example/'+name+'@sha256:'+'a'*64}))
            env={**os.environ,'RELEASE_VERSION':'fixture-1','DATABASE_MIN':'55','DATABASE_MAX':'56',
                 'GITHUB_SHA':'a'*40,'RELEASE_NOTES':'Isolated release fixture'}
            rejected=subprocess.run([sys.executable,str(script),str(source),str(root/'old')],env=env,capture_output=True,text=True)
            self.assertNotEqual(0,rejected.returncode);self.assertIn('topology',rejected.stderr)
            self.assertFalse((root/'old').exists())
            env['DATABASE_MIN']='56'
            subprocess.run([sys.executable,str(script),str(source),str(root/'new')],env=env,check=True,capture_output=True)
            release=json.loads((root/'new/releases.json').read_text())[0]
            self.assertEqual(56,release['databaseMin']);self.assertTrue(release['backwardCompatible'])
