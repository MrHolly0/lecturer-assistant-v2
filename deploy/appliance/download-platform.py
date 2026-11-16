#!/usr/bin/env python3
"""Bundle the exact upstream KEDA manifest at image build time, never on a university VM."""
import hashlib
from pathlib import Path
import random
import time
import urllib.request

url='https://github.com/kedacore/keda/releases/download/v2.21.0/keda-2.21.0.yaml'
expected='b43c89ffeef81722d7e2dd2c079d74789767a0f89cae1336cff784994814f6d7'
for attempt in range(4):
    try:
        with urllib.request.urlopen(url,timeout=45) as response:data=response.read(2*1024*1024)
        if hashlib.sha256(data).hexdigest()!=expected:raise ValueError('KEDA manifest checksum mismatch')
        Path('/opt/lecturer/keda.yaml').write_bytes(data)
        break
    except OSError:
        if attempt==3:raise
        time.sleep(random.uniform(.5,1)*2**attempt)
