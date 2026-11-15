#!/usr/bin/env python3
"""Sign reviewed release metadata. Publishing the resulting public JSON is a separate CI step."""
import argparse
import base64
import datetime as dt
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--releases', required=True, help='JSON array with tested image digests and compatibility metadata')
parser.add_argument('--private-key', required=True, help='Ed25519 PEM private key, kept only in release CI')
parser.add_argument('--output', required=True)
parser.add_argument('--valid-hours', type=int, default=168)
parser.add_argument('--openssl', default='openssl')
args = parser.parse_args()
if not 1 <= args.valid_hours <= 720:
    parser.error('valid-hours must be between 1 and 720')
releases = json.loads(Path(args.releases).read_text())
if not isinstance(releases, list):
    parser.error('releases must be a JSON array')
catalog = {'schema': 1, 'expiresAt': (dt.datetime.now(dt.timezone.utc)
           + dt.timedelta(hours=args.valid_hours)).isoformat(), 'releases': releases}
payload = json.dumps(catalog, ensure_ascii=False, separators=(',', ':'))
with tempfile.TemporaryDirectory(prefix='lecturer-catalog-sign-') as directory:
    message, signature = Path(directory) / 'catalog', Path(directory) / 'signature'
    message.write_bytes(payload.encode())
    subprocess.run([args.openssl, 'pkeyutl', '-sign', '-inkey', args.private_key, '-rawin',
                    '-in', str(message), '-out', str(signature)], check=True, timeout=10)
    envelope = {'payload': payload, 'signature': base64.b64encode(signature.read_bytes()).decode()}
Path(args.output).write_text(json.dumps(envelope, ensure_ascii=False) + '\n')
