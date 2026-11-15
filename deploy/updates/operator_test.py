import base64
import copy
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import uuid

spec = importlib.util.spec_from_file_location('installation_operator', Path(__file__).with_name('installation_operator.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.private, self.public = self.root/'key.pem', self.root/'key.pub.pem'
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'ED25519', '-out', str(self.private)],
                       check=True, capture_output=True)
        subprocess.run(['openssl', 'pkey', '-in', str(self.private), '-pubout', '-out', str(self.public)],
                       check=True, capture_output=True)
        self.release = {'id': 'test-1', 'version': '1.0.1', 'notes': 'Обновление', 'commit': 'a'*40,
                        'databaseMin': 0, 'databaseMax': 100, 'backwardCompatible': True,
                        'images': {'core': 'example.test/core@sha256:'+'a'*64,
                                   'web': 'example.test/web@sha256:'+'b'*64}}
        self.config = {'repo': str(self.root), 'stateDir': str(self.root/'state'), 'kind': 'compose',
                       'publicKey': str(self.public), 'minFreeBytes': 0,
                       'project': 'isolated-updates-test', 'composeFiles': ['docker-compose.yml', 'docker-compose.prod.yml'],
                       'bindings': {'core': ['core'], 'web': ['web']}}
        (self.root/'.env').write_text('PUBLIC_MODE=domain\n')

    def envelope(self, releases=None, expired=False):
        payload = json.dumps({'schema': 1, 'expiresAt': (dt.datetime.now(dt.timezone.utc)
                             + dt.timedelta(hours=-1 if expired else 1)).isoformat(),
                              'releases': releases if releases is not None else [self.release]}, ensure_ascii=False)
        message, sig = self.root/'message', self.root/'sig'
        message.write_text(payload)
        subprocess.run(['openssl', 'pkeyutl', '-sign', '-inkey', str(self.private), '-rawin',
                        '-in', str(message), '-out', str(sig)], check=True, capture_output=True)
        return {'payload': payload, 'signature': base64.b64encode(sig.read_bytes()).decode()}

    def test_signature_expiry_and_mutable_tags_are_rejected(self):
        envelope = self.envelope()
        self.assertEqual('test-1', operator.validate_release(envelope, self.public, 'test-1')['id'])
        envelope['payload'] += ' '
        with self.assertRaises(operator.UpdateError): operator.validate_release(envelope, self.public)
        with self.assertRaises(operator.UpdateError): operator.validate_release(self.envelope(expired=True), self.public)
        release = copy.deepcopy(self.release)
        release['images']['core'] = 'example.test/core:latest'
        with self.assertRaises(operator.UpdateError): operator.validate_release(self.envelope([release]), self.public)
        release = copy.deepcopy(self.release)
        release['backwardCompatible'] = False
        with self.assertRaises(operator.UpdateError): operator.validate_release(self.envelope([release]), self.public)

    def test_json_duplicate_keys_are_rejected(self):
        with self.assertRaises(operator.UpdateError): operator.decode('{"owner":1,"owner":2}')

    def worker(self, fail=None):
        calls = []
        class Api:
            def post(self, path, body, **options):
                calls.append(('rpc', path.rsplit('/',1)[-1], body.get('stage')))
                if path.endswith('/prepare'): return {'stage': 'BACKING_UP'}
                return None
        class Driver:
            def preflight(self, release, log): calls.append(('preflight',))
            def backup(self, log):
                calls.append(('backup',))
                if fail == 'backup': raise operator.UpdateError('private-secret-not-for-ui')
            def apply(self, release, log):
                self.guard()
                calls.append(('apply',))
                if fail == 'apply': raise operator.UpdateError('private-secret-not-for-ui')
            def verify(self, release, log): calls.append(('verify',))
        worker = operator.Worker(self.config, api=Api(), driver=Driver())
        assignment = {'job': {'id': str(uuid.uuid4()), 'releaseId': 'test-1', 'fence': 1}, 'catalog': self.envelope()}
        return worker, assignment, calls

    def test_worker_backs_up_before_apply_and_verifies_before_success(self):
        worker, assignment, calls = self.worker()
        with patch.object(operator, 'health') as healthy: worker.execute(assignment)
        self.assertLess(calls.index(('backup',)), calls.index(('apply',)))
        self.assertLess(calls.index(('verify',)), calls.index(('rpc','progress','SUCCEEDED')))
        healthy.assert_called_once()
        self.assertIsNone(operator.decode(worker.journal.read_text())['active'])

    def test_failed_backup_never_changes_images(self):
        worker, assignment, calls = self.worker(fail='backup')
        with self.assertRaises(operator.UpdateError): worker.execute(assignment)
        self.assertNotIn(('apply',), calls)
        self.assertIn(('rpc','progress','FAILED'), calls)

    def test_failed_apply_is_not_replayed_after_operator_restart(self):
        worker, assignment, calls = self.worker(fail='apply')
        with self.assertRaises(operator.UpdateError): worker.execute(assignment)
        self.assertIn(('rpc','progress','NEEDS_ATTENTION'), calls)
        before = calls.count(('apply',))
        worker.execute(assignment)
        self.assertEqual(before, calls.count(('apply',)))
        # A new server-issued job is allowed only after explicit administrative review.
        next_job = copy.deepcopy(assignment)
        next_job['job']['id'] = str(uuid.uuid4())
        worker.driver = self.worker()[0].driver
        with patch.object(operator, 'health'): worker.execute(next_job)
        self.assertTrue(list(worker.state.glob('reviewed-*.json')))

    def test_compose_driver_uses_fixed_commands_and_persists_digest_override(self):
        calls = []
        def run(argv, config, log, **options): calls.append(argv)
        def read(argv, config):
            if 'ps' in argv: return 'container-' + argv[-1]
            return self.release['images'][argv[-1].split('-')[-1]]
        state = self.root/'state';state.mkdir()
        driver = operator.Compose(self.config, state, run=run, read=read)
        driver.preflight(self.release, io.StringIO())
        driver.backup(io.StringIO());driver.apply(self.release, io.StringIO())
        self.assertEqual(self.release['images']['core'], operator.decode(driver.override.read_text())['services']['core']['image'])
        driver.verify(self.release, io.StringIO())
        driver.read = lambda argv, config: 'wrong-digest'
        with self.assertRaises(operator.UpdateError): driver.verify(self.release, io.StringIO())
        self.assertTrue(any('--no-build' in args and '--no-deps' in args for args in calls))
        self.assertFalse(any('down' in args or 'rm' in args for args in calls))
        self.assertTrue(any(args[:2] == ['env', 'LECTURER_COMPOSE_PROJECT=isolated-updates-test'] for args in calls))

    def test_kubernetes_driver_updates_only_images_and_preserves_installer_descriptor(self):
        self.config.update(kind='kubernetes', namespace='test-lecturer', bindings={
            'core': [{'resource':'deployment/core','container':'core'}],
            'web': [{'resource':'deployment/web','container':'web'}]})
        state = self.root/'state';state.mkdir()
        actual = {'core': 'old-core', 'web':'old-web'};calls=[]
        def read(argv, config):
            name = argv[argv.index('get')+1].split('/')[1]
            return json.dumps({'spec':{'template':{'spec':{'containers':[{'name':name,'image':actual[name]}]}}}})
        def run(argv, config, log, **options):
            calls.append(argv)
            if 'set' in argv:
                name, image = argv[-1].split('=',1);actual[name]=image
        driver=operator.Kubernetes(self.config,state,run=run,read=read)
        driver.preflight(self.release,io.StringIO());driver.backup(io.StringIO())
        driver.apply(self.release,io.StringIO());driver.verify(self.release,io.StringIO())
        self.assertEqual(self.release['images'], actual)
        self.assertFalse(any('scale' in args or 'apply' in args or 'delete' in args for args in calls))
        descriptor=operator.decode((self.root/'deploy/k8s/.state/images.json').read_text())
        self.assertEqual(actual,descriptor)
        actual['core']='other-image'
        with self.assertRaises(operator.UpdateError):driver.verify(self.release,io.StringIO())


if __name__ == '__main__': unittest.main()
