import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { openBroker, ensureDurableConsumers, ANALYTICS_QUEUE } from '../common/broker.mjs';
import { rpcClient, requiredKey, sameSecret, integer, sleep, backoff, logFailure, healthHandler } from '../common/runtime.mjs';
import { AnalyticsStore } from './store.mjs';

const key = requiredKey('SERVICE_ANALYTICS_KEY');
const pool = new pg.Pool({ connectionString: process.env.ANALYTICS_DATABASE_URL,
  max: integer(process.env.DB_POOL_MAX_SIZE, 4, 1, 16), connectionTimeoutMillis: 3000,
  statement_timeout: 5000, idle_in_transaction_session_timeout: 10000 });
pool.on('error', error => logFailure('analytics-db', error));
const schemaConnection = await pool.connect();
try {
  await schemaConnection.query('begin');
  await schemaConnection.query('select pg_advisory_xact_lock(847240911)');
  await schemaConnection.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await schemaConnection.query('commit');
} catch (error) {
  await schemaConnection.query('rollback'); throw error;
} finally { schemaConnection.release(); }
const store = new AnalyticsStore(pool);
const rpc = rpcClient(process.env.CORE_URL ?? 'http://core:8080', key);
const shutdown = new AbortController();
let ready = false, broker, activeRequests = 0;
const health = healthHandler(() => ready);
const server = createServer(async (request, response) => {
  if (request.url === '/health' || request.url === '/ready') return health(request, response);
  const redrive = request.url === '/internal/v1/analytics/redrive';
  if (request.method !== 'POST' || (request.url !== '/internal/v1/analytics/reports' && !redrive)) {
    response.writeHead(404).end(); return;
  }
  if (!sameSecret(key, request.headers['x-service-key'])) { response.writeHead(401).end(); return; }
  if (activeRequests >= 32) { response.writeHead(503, { 'Retry-After': '2' }).end(); return; }
  activeRequests++;
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length; if (size > 8192) throw Object.assign(new Error('Body too large'), { status: 413 });
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks)); } catch { throw Object.assign(new Error('JSON'), { status: 400 }); }
    if (!/^[0-9a-f-]{36}$/i.test(body.sessionId) || (!redrive && !/^[0-9a-f]{64}$/.test(body.fingerprint)))
      throw Object.assign(new Error('Invalid query'), { status: 400 });
    if (redrive) {
      await store.enqueue(body.sessionId);
      response.writeHead(202, { 'Content-Type': 'application/json' }).end('{"status":"QUEUED"}'); return;
    }
    const report = await store.read(body.sessionId, body.fingerprint);
    response.writeHead(report ? 200 : 202, { 'Content-Type': 'application/json',
      'Cache-Control': 'no-store', 'Retry-After': '2' }).end(JSON.stringify(report ?? { status: 'PENDING' }));
  } catch (error) {
    logFailure('analytics-http', error);
    if (!response.headersSent) response.writeHead(error.status ?? 503, { 'Retry-After': '2' }).end();
  } finally { activeRequests--; }
});
server.requestTimeout = 10000; server.headersTimeout = 10000;
server.listen(integer(process.env.PORT, 8092, 1, 65535), '0.0.0.0');
const retention = setInterval(() => void store.retain().catch(error => logFailure('analytics-retention', error)), 60000);
const stop = () => {
  ready = false; shutdown.abort(); clearInterval(retention); server.close(); server.closeIdleConnections();
  void broker?.connection.close().catch(() => {});
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);

async function worker() {
  let failures = 0;
  while (!shutdown.signal.aborted) {
    let job;
    try {
      job = await store.claim(); ready = true; failures = 0;
      if (!job) { await sleep(500, shutdown.signal); continue; }
      try {
        const exported = await rpc('/internal/v1/analytics/export', { sessionId: job.session_id },
          { timeoutMs: 30000, maxBytes: 12 * 1024 * 1024 });
        await store.finish(job, exported);
      } catch (error) {
        if ([404, 409].includes(error.status)) await store.finish(job, null);
        else { await store.retry(job); logFailure('analytics-report', error); }
      }
    } catch (error) {
      ready = false;
      if (!shutdown.signal.aborted) logFailure('analytics-worker', error);
      await sleep(backoff(failures++), shutdown.signal).catch(() => {});
    }
  }
}

async function consumer() {
  let failures = 0;
  while (!shutdown.signal.aborted) {
    try {
      broker = await openBroker(process.env.AMQP_URL ?? 'amqp://rabbitmq');
      const { channel, connection } = broker;
      await ensureDurableConsumers(channel); await channel.prefetch(32);
      await channel.consume(ANALYTICS_QUEUE, message => {
        if (!message) { void connection.close().catch(() => {}); return; }
        void store.receive(message.content).then(() => channel.ack(message)).catch(error => {
          logFailure('analytics-inbox', error);
          // Closing the channel requeues uncommitted messages; avoid immediate nack/requeue loops.
          void connection.close().catch(() => {});
        });
      });
      failures = 0;
      await new Promise(resolve => {
        const done = () => {
          connection.off('close', done); shutdown.signal.removeEventListener('abort', done); resolve();
        };
        connection.once('close', done); shutdown.signal.addEventListener('abort', done, { once: true });
      });
    } catch (error) { if (!shutdown.signal.aborted) logFailure('analytics-consumer', error); }
    finally { await broker?.connection.close().catch(() => {}); broker = undefined; }
    if (!shutdown.signal.aborted) await sleep(backoff(failures++), shutdown.signal).catch(() => {});
  }
}
await Promise.all([worker(), consumer()]);
await pool.end();
