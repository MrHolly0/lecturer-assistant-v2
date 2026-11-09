import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

// Anchored once: a wall-clock rollback must never extend an already granted permission.
export const monotonicEpoch = () => performance.timeOrigin + performance.now();

export const sleep = (ms, signal) => delay(ms, undefined, { signal });
export const backoff = attempt => Math.random() * Math.min(30000, 250 * 2 ** Math.min(attempt, 8));
export const logFailure = (component, error) => console.error(JSON.stringify({
  level: 'warn', component, code: error?.code ?? error?.name ?? 'ERROR', status: error?.status
}));

export function integer(value, fallback, min = 1, max = 1000000) {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('Invalid numeric configuration');
  return n;
}

export function requiredKey(name) {
  const key = process.env[name];
  if (!key || key.length < 32) throw new Error(`Configure ${name} with at least 32 characters`);
  return key;
}

export function sameSecret(expected, presented) {
  if (!expected || !presented) return false;
  const a = Buffer.from(expected), b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class RpcError extends Error {
  constructor(status) { super(`Service response ${status}`); this.status = status; }
}

export async function readJson(response, maxBytes = 20 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Service response exceeds limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export function rpcClient(base, key, fetcher = fetch, now = monotonicEpoch) {
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
    throw new Error('Invalid service address');
  return async (path, payload, options = {}) => {
    const started = now();
    const response = await fetcher(new URL(path, origin), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Service-Key': key },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(options.timeoutMs ?? 4000)
    });
    if (!response.ok) { await response.body?.cancel(); throw new RpcError(response.status); }
    if (response.status === 204 || response.headers.get('content-length') === '0') return null;
    const data = await readJson(response, options.maxBytes);
    if (data && typeof data === 'object' && 'checkedAt' in data && 'expiresAt' in data) {
      const duration = Date.parse(data.expiresAt) - Date.parse(data.checkedAt);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 5000) throw new Error('Invalid permission lease');
      // Request start precedes the authority check. Neither wall-clock skew nor a delayed response
      // may extend permission. This metadata is never serialized to public clients.
      Object.defineProperty(data, 'permissionDeadline', { value: started + duration - 250 });
    }
    return data;
  };
}

export function healthHandler(ready, metrics = () => ({})) {
  return (request, response) => {
    if (request.method === 'GET' && request.url === '/metrics') {
      const values = { process_resident_memory_bytes: process.memoryUsage().rss,
        process_heap_used_bytes: process.memoryUsage().heapUsed, process_uptime_seconds: process.uptime(), ...metrics() };
      response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' });
      response.end(Object.entries(values).filter(([name, value]) => /^[a-z_][a-z_0-9]*$/.test(name)
        && Number.isFinite(value)).map(([name, value]) => `${name} ${value}\n`).join(''));
      return;
    }
    if (request.method !== 'GET' || !['/health', '/ready'].includes(request.url)) {
      response.writeHead(404).end(); return;
    }
    const ok = request.url === '/health' || ready();
    response.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ status: ok ? 'UP' : 'NOT_READY' }));
  };
}

export function healthServer(port, ready, metrics) {
  const server = createServer(healthHandler(ready, metrics));
  server.listen(port, '0.0.0.0');
  return server;
}
