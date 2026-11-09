#!/usr/bin/env python3
"""Create separate lab credentials without touching the existing stand or its .env."""
from pathlib import Path
import os
import secrets

root = Path(__file__).resolve().parent
env = root / '.env'
config = root / 'livekit.local.yaml'
if env.exists() or config.exists():
    raise SystemExit('Configuration already exists; refusing to replace credentials.')
names = ['POSTGRES_PASSWORD', 'CONTENT_DB_PASSWORD', 'ANALYTICS_PASSWORD', 'RABBITMQ_PASSWORD', 'RABBITMQ_ERLANG_COOKIE',
         'REDIS_PASSWORD', 'JWT_SECRET', 'SLIDE_IMAGE_URL_SECRET', 'CHANNEL_INTERNAL_API_KEY',
         'SERVICE_EVENTS_KEY', 'SERVICE_REALTIME_KEY', 'SERVICE_ANALYTICS_KEY', 'SERVICE_MEDIA_KEY',
         'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'ADMIN_SETUP_TOKEN']
values = {name: secrets.token_hex(32) for name in names}
values.update(PUBLIC_URL='http://localhost:18089', WEB_BIND='127.0.0.1',
              WEB_PORT='18089', LIVEKIT_PUBLIC_URL='ws://localhost:18089')
text = '\n'.join(f'{key}={value}' for key, value in values.items()) + '\n'
yaml = f'''port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  tcp_port: 7881
  udp_port: 7882
  node_ip: 127.0.0.1
  use_external_ip: false
redis:
  address: redis:6379
  password: "{values['REDIS_PASSWORD']}"
keys:
  {values['LIVEKIT_API_KEY']}: {values['LIVEKIT_API_SECRET']}
room:
  max_participants: 1500
  empty_timeout: 60
  departure_timeout: 10
turn:
  enabled: true
  domain: localhost
  udp_port: 3478
logging:
  level: warn
'''
for path, content in [(env, text), (config, yaml)]:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)
print('Created private lab configuration. No stand services were started.')
