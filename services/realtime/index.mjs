import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { openBroker, EXCHANGE } from '../common/broker.mjs';
import { rpcClient, requiredKey, integer, backoff, sleep, logFailure, healthHandler } from '../common/runtime.mjs';
import { RealtimeHub } from './hub.mjs';
import { attachStomp } from './stomp.mjs';

const rpc = rpcClient(process.env.CORE_URL ?? 'http://core:8080', requiredKey('SERVICE_REALTIME_KEY'));
const hub = new RealtimeHub(rpc, { maxConnections: integer(process.env.MAX_CONNECTIONS, 6000),
  maxRooms: integer(process.env.MAX_ROOMS, 1024), concurrency: integer(process.env.RPC_CONCURRENCY, 16, 1, 128),
  grantConcurrency: integer(process.env.GRANT_CONCURRENCY, 8, 1, 64) });
const origins = new Set((process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:18089').split(',').map(x => x.trim()));
const originAllowed = request => !request.headers.origin || origins.has(request.headers.origin);
const shutdown = new AbortController();
let authorityReady = false, probeBusy = false, brokerConnected = false, broker, rawSockets = 0;
const health = healthHandler(() => authorityReady && !hub.closed, () => ({
  realtime_connections: hub.clients.size, realtime_rooms: hub.rooms.size,
  realtime_rpc_in_flight: hub.inFlight, realtime_snapshots_total: hub.stats.snapshots,
  realtime_pending_grants: hub.pendingGrants,
  realtime_slow_consumers_total: hub.stats.slowConsumers, realtime_revocations_total: hub.stats.revoked,
  realtime_rpc_errors_total: hub.stats.rpcErrors, realtime_broker_connected: Number(brokerConnected),
  realtime_expired_leases_total: hub.stats.expiredLeases, realtime_denied_total: hub.stats.denied,
  realtime_stale_grants_total: hub.stats.staleGrants, realtime_rpc_max_seconds: hub.stats.rpcMaxMs / 1000,
  realtime_tick_max_gap_seconds: hub.stats.tickMaxGapMs / 1000,
  realtime_clock_offset_seconds: (Date.now() - hub.now()) / 1000,
  realtime_invalidations_total: hub.stats.invalidations,
  realtime_matched_invalidations_total: hub.stats.matchedInvalidations
}));
const server = createServer(async (request, response) => {
  if (['/health', '/ready', '/metrics'].includes(request.url)) return health(request, response);
  if (!originAllowed(request)) { response.writeHead(403).end(); return; }
  const url = new URL(request.url, 'http://gateway');
  const match = url.pathname.match(/^\/api\/v1\/student\/sessions\/([A-Z0-9]{4,16})\/events(\/public)?$/);
  if (request.method !== 'GET' || !match) { response.writeHead(404).end(); return; }
  const token = url.searchParams.get('participantToken') ?? '';
  if (!match[2] && (!token || token.length > 256)) { response.writeHead(401).end(); return; }
  try {
    if (hub.studentCount + hub.pendingStudents + rawSockets >= hub.maxConnections)
      throw Object.assign(new Error('Admission full'), { status: 503 });
    request.socket.setTimeout(0); response.on('error', () => {});
    await hub.addStudent(match[1], token, response, Boolean(match[2]));
  } catch (error) {
    if (!response.headersSent) response.writeHead([401, 403, 404].includes(error.status) ? error.status : 503,
      { 'Retry-After': '2', 'Cache-Control': 'no-store' }).end();
    else response.end();
  }
});
server.requestTimeout = 10000; server.headersTimeout = 10000;
const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536, clientTracking: false });
server.on('upgrade', (request, socket, head) => {
  const match = request.url.match(/^\/ws\/session\/([0-9a-f-]{36})$/i);
  if (!match || !originAllowed(request)
      || hub.studentCount + hub.pendingStudents + rawSockets >= hub.maxConnections) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
  }
  sockets.handleUpgrade(request, socket, head, ws => {
    rawSockets++; ws.once('close', () => rawSockets--);
    attachStomp(ws, match[1], hub);
  });
});
server.listen(integer(process.env.PORT, 8091, 1, 65535), '0.0.0.0');
const tick = setInterval(() => hub.tick(), 250);
const probe = setInterval(async () => {
  if (probeBusy) return;
  probeBusy = true;
  try { await rpc('/internal/v1/realtime/health', {}); authorityReady = true; }
  catch { authorityReady = false; }
  finally { probeBusy = false; }
}, 2000);
const stop = () => {
  shutdown.abort(); clearInterval(tick); clearInterval(probe); hub.close();
  sockets.close(); server.close(); server.closeIdleConnections();
  void broker?.connection.close().catch(() => {});
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);

let failures = 0;
while (!shutdown.signal.aborted) {
  try {
    broker = await openBroker(process.env.AMQP_URL ?? 'amqp://rabbitmq');
    const { channel, connection } = broker;
    await channel.prefetch(128);
    const queue = await channel.assertQueue(`lecturer.realtime.${randomUUID()}`, {
      exclusive: true, autoDelete: true, durable: false,
      arguments: { 'x-max-length': 10000, 'x-message-ttl': 15000 }
    });
    await channel.bindQueue(queue.queue, EXCHANGE, 'realtime.#');
    await channel.bindQueue(queue.queue, EXCHANGE, 'domain.#');
    await channel.consume(queue.queue, message => {
      if (!message) { void connection.close().catch(() => {}); return; }
      try { if (message.content.length <= 65536) hub.invalidate(JSON.parse(message.content)); }
      catch { /* Invalidations are recovered by the next authoritative snapshot. */ }
      channel.ack(message);
    });
    brokerConnected = true;
    failures = 0;
    await new Promise(resolve => {
      const done = () => {
        connection.off('close', done); shutdown.signal.removeEventListener('abort', done); resolve();
      };
      connection.once('close', done);
      shutdown.signal.addEventListener('abort', done, { once: true });
    });
  } catch (error) { if (!shutdown.signal.aborted) logFailure('realtime-broker', error); }
  finally { brokerConnected = false; await broker?.connection.close().catch(() => {}); broker = undefined; }
  if (!shutdown.signal.aborted) await sleep(backoff(failures++), shutdown.signal).catch(() => {});
}
