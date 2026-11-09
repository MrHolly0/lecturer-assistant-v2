import { createServer, request as upstreamRequest } from 'node:http';
import { request as upstreamSecureRequest } from 'node:https';
import { RoomServiceClient } from 'livekit-server-sdk';
import { MediaAccess } from './access.mjs';
import { rpcClient, requiredKey, sameSecret, integer, sleep, backoff, logFailure, healthHandler,
  monotonicEpoch } from '../common/runtime.mjs';

const key = requiredKey('SERVICE_MEDIA_KEY'), apiKey = requiredKey('LIVEKIT_API_KEY');
const apiSecret = requiredKey('LIVEKIT_API_SECRET');
const host = process.env.LIVEKIT_INTERNAL_URL ?? 'http://sfu:7880';
const publicUrl = process.env.LIVEKIT_PUBLIC_URL;
if (!publicUrl || !/^wss?:\/\//.test(publicUrl)) throw new Error('Configure LIVEKIT_PUBLIC_URL');
const rpc = rpcClient(process.env.CORE_URL ?? 'http://core:8080', key);
const rooms = new RoomServiceClient(host, apiKey, apiSecret, { requestTimeout: 2 });
const access = new MediaAccess(rpc, rooms, { apiKey, apiSecret, publicUrl });
const shutdown = new AbortController();
let validUntil = 0, admissions = 0;
const liveSockets = new Set();
const health = healthHandler(() => monotonicEpoch() < validUntil);

async function permit(request) {
  const url = new URL(request.url, 'http://media');
  if (!url.pathname.startsWith('/rtc') || admissions >= 64) throw new Error('Admission limited');
  const token = url.searchParams.get('access_token') ?? request.headers.authorization?.replace(/^Bearer /, '');
  if (!token || token.length > 8192) throw new Error('Token required');
  admissions++;
  try { await access.permitSignal(token); }
  finally { admissions--; }
}

function proxy(request) {
  const target = new URL(request.url, host);
  return (target.protocol === 'https:' ? upstreamSecureRequest : upstreamRequest)(target, {
    method: request.method, headers: { ...request.headers, host: target.host }, timeout: 5000
  });
}

const server = createServer(async (request, response) => {
  if (request.url === '/health' || request.url === '/ready') return health(request, response);
  if (request.url.startsWith('/rtc')) {
    try {
      await permit(request);
      const upstream = proxy(request);
      upstream.on('response', res => { response.writeHead(res.statusCode, res.headers); res.pipe(response); });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(503); response.end(); });
      upstream.on('timeout', () => upstream.destroy());
      response.on('close', () => upstream.destroy()); request.pipe(upstream);
    } catch { response.writeHead(403).end(); }
    return;
  }
  if (request.method !== 'POST' || request.url !== '/internal/v1/media/ticket') {
    response.writeHead(404).end(); return;
  }
  if (!sameSecret(key, request.headers['x-service-key'])) { response.writeHead(401).end(); return; }
  if (admissions >= 64 || monotonicEpoch() >= validUntil) { response.writeHead(503, { 'Retry-After': '2' }).end(); return; }
  admissions++;
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length; if (size > 4096) throw Object.assign(new Error('Large body'), { status: 413 });
      chunks.push(chunk);
    }
    const { grantId } = JSON.parse(Buffer.concat(chunks));
    const ticket = await access.ticket(grantId);
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(ticket));
  } catch (error) {
    logFailure('media-ticket', error); response.writeHead(error.status ?? 503, { 'Retry-After': '2' }).end();
  } finally { admissions--; }
});
server.requestTimeout = 10000; server.headersTimeout = 10000;
server.on('upgrade', async (request, socket, head) => {
  socket.on('error', () => {});
  try {
    if (request.headers.upgrade?.toLowerCase() !== 'websocket') throw new Error('WebSocket upgrade required');
    if (liveSockets.size >= 12000) throw new Error('Signal limit');
    await permit(request);
    if (socket.destroyed) return;
    const upstream = proxy(request);
    socket.once('close', () => upstream.destroy());
    upstream.on('upgrade', (response, target, upstreamHead) => {
      if (socket.destroyed) { target.destroy(); return; }
      target.setTimeout(0); target.on('error', () => socket.destroy());
      liveSockets.add(socket); socket.once('close', () => { liveSockets.delete(socket); target.destroy(); });
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
        .map(([key, value]) => `${key}: ${value}\r\n`).join('')}\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) target.write(head);
      socket.pipe(target); target.pipe(socket);
    });
    upstream.on('response', () => socket.destroy());
    upstream.on('error', () => socket.destroy()); upstream.on('timeout', () => upstream.destroy()); upstream.end();
  } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
});
server.listen(integer(process.env.PORT, 8093, 1, 65535), '0.0.0.0');
const stop = () => {
  validUntil = 0; shutdown.abort(); server.close(); server.closeIdleConnections();
  for (const socket of liveSockets) socket.destroy();
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);

let failures = 0;
while (!shutdown.signal.aborted) {
  try {
    const authority = await access.authorize([]);
    await rooms.listRooms();
    validUntil = authority.permissionDeadline; failures = 0;
    await sleep(2000, shutdown.signal);
  } catch (error) {
    validUntil = 0;
    if (!shutdown.signal.aborted) {
      logFailure('media-access', error);
    }
    await sleep(backoff(failures++), shutdown.signal).catch(() => {});
  }
}
