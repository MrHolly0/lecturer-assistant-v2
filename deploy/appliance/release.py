#!/usr/bin/env python3
"""Assemble immutable release descriptors. Called after CI; no deployment occurs here."""
import json
import os
from pathlib import Path
import re
import sys
from render import IMAGE_KEYS

source, output = map(Path, sys.argv[1:])
images = {}
for path in sorted(source.glob('*.json')):
    value=json.loads(path.read_text())
    if images.keys() & value.keys():raise ValueError('Duplicate component descriptor')
    images.update(value)
if set(images) != set(IMAGE_KEYS)|{'controller'}:raise ValueError('Incomplete release images')
if any(not re.fullmatch(r'[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}', i) for i in images.values()):
    raise ValueError('Immutable digests required')
version=os.environ['RELEASE_VERSION']
if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}',version):raise ValueError('Invalid version')
minimum,maximum=int(os.environ['DATABASE_MIN']),int(os.environ['DATABASE_MAX'])
if not 0<=minimum<=maximum:raise ValueError('Invalid schema interval')
commit=os.environ['GITHUB_SHA']
if not re.fullmatch(r'[a-f0-9]{40}',commit):raise ValueError('Invalid commit')
notes=os.environ['RELEASE_NOTES']
if not notes or len(notes)>6000:raise ValueError('Invalid notes')
controller=images.pop('controller')
output.mkdir(parents=True,exist_ok=True)
(output/'images.json').write_text(json.dumps(images,indent=2)+'\n')
(output/'controller-image.txt').write_text(controller+'\n')
release={'id':version,'version':version,'notes':notes,'commit':commit,'databaseMin':minimum,
         'databaseMax':maximum,'backwardCompatible':True,'images':images}
(output/'releases.json').write_text(json.dumps([release],ensure_ascii=False)+'\n')
(output/'notes.txt').write_text(notes+'\n\nCatalog expires in 30 days. Publish catalog.json unchanged at the institution\'s configured HTTPS endpoint (without redirects); refresh its signature before expiry.\n')
