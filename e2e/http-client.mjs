import { Agent, request } from 'node:http';
import { Readable } from 'node:stream';

/** Keep command/image sockets separate from thousands of long-lived SSE fetches. */
export function boundedHttpClient(origin, connections = 32) {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || base.username || base.password
      || !Number.isSafeInteger(connections) || connections < 1 || connections > 128)
    throw new Error('Invalid isolated HTTP client configuration');
  const agent = new Agent({ keepAlive: true, maxSockets: connections, maxTotalSockets: connections,
    maxFreeSockets: Math.min(connections, 16), scheduling: 'lifo' });
  return {
    fetch(url, options = {}) {
      const target = new URL(url, base);
      if (target.origin !== base.origin) throw new Error('Cross-origin load requests are forbidden');
      // Only the single setup upload needs multipart serialization. It never shares this pool.
      if (options.body instanceof FormData) return fetch(target, options);
      return new Promise((resolve, reject) => {
        const outgoing = request(target, { method: options.method,
          headers: { 'Accept-Encoding': 'identity', ...options.headers },
          signal: options.signal, agent }, incoming => {
          try {
            const empty = options.method === 'HEAD' || [204, 205, 304].includes(incoming.statusCode);
            resolve(new Response(empty ? null : Readable.toWeb(incoming), {
              status: incoming.statusCode, headers: incoming.headers
            }));
            if (empty) incoming.resume();
          } catch (error) { incoming.destroy(); reject(error); }
        });
        outgoing.once('error', reject);
        outgoing.end(options.body);
      });
    },
    close() { agent.destroy(); }
  };
}

export function networkErrorCode(error) {
  const value = error?.code ?? error?.cause?.code ?? error?.cause?.errors?.[0]?.code;
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,50}$/.test(value) ? value : 'UNSPECIFIED';
}
