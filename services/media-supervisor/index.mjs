import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { RoomServiceClient, AccessToken } from 'livekit-server-sdk';
import { SfuWatchdog } from './watchdog.mjs';
import { MediaAccess } from '../media-control/access.mjs';
import { rpcClient, requiredKey, readJson, sleep, logFailure } from '../common/runtime.mjs';
const key = requiredKey('SERVICE_MEDIA_KEY');
const apiKey = requiredKey('LIVEKIT_API_KEY'), apiSecret = requiredKey('LIVEKIT_API_SECRET');
const rpc = rpcClient(process.env.CORE_URL ?? 'http://authority:80', key);
const rooms = new RoomServiceClient('http://127.0.0.1:7880', apiKey, apiSecret, { requestTimeout: 2 });
const access = new MediaAccess(rpc, rooms, { apiKey, apiSecret });
let draining = false;
const watchdog = new SfuWatchdog({ start: () => {
  if (draining) return null;
  const child = spawn('/usr/local/bin/livekit-server', ['--config', '/etc/livekit.yaml'], { stdio: 'inherit' });
  child.on('error', () => watchdog.exited(child)); child.on('exit', () => watchdog.exited(child));
  return child;
}, stop: child => child.kill('SIGKILL') });
const server = createServer((request, response) => {
  if (request.method !== 'GET' || !['/health', '/ready'].includes(request.url)) { response.writeHead(404).end(); return; }
  const ok = request.url === '/health' || (!draining && watchdog.child && watchdog.now() < watchdog.validUntil);
  response.writeHead(ok ? 200 : 503).end(ok ? 'UP' : 'NOT_READY');
});
server.listen(8096, '0.0.0.0');
const finish = () => { clearInterval(tick); server.close(); server.closeIdleConnections(); };
const tick = setInterval(() => { watchdog.tick(); if (draining && !watchdog.child) finish(); }, 100);
const stop = () => {
  if (draining) return;
  draining = true;
  if (watchdog.child) watchdog.child.kill('SIGTERM'); else finish();
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);

while (!draining || watchdog.child) {
  try {
    if (!watchdog.child) {
      if (draining) break;
      const authority = await access.authorize([]);
      watchdog.renew(authority.permissionDeadline);
    } else {
      const token = new AccessToken(apiKey, apiSecret, { ttl: 30 }); token.addGrant({ roomList: true });
      const response = await fetch('http://127.0.0.1:7880/internal/access-inventory', {
        headers: { Authorization: 'Bearer ' + await token.toJwt() }, signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error('Local SFU inventory unavailable');
      const data = await readJson(response, 4 * 1024 * 1024);
      if (data.schemaVersion !== 1 || !Array.isArray(data.rooms) || data.rooms.some(room =>
        !/^lecture-[0-9a-f-]{36}$/i.test(room.name) || !Array.isArray(room.participants)))
        throw new Error('Incompatible SFU inventory');
      watchdog.renew(await access.sweep(data.rooms));
    }
  } catch (error) { if (!draining) logFailure('local-media-access', error); }
  await sleep(1500 + Math.random() * 250);
}
finish();
