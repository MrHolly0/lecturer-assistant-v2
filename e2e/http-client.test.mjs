import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { boundedHttpClient, networkErrorCode } from './http-client.mjs';

test('bounded command pool keeps working while SSE sockets open and abort', async t => {
  let active = 0, maximum = 0;
  const server = createServer((request, response) => {
    if (request.url === '/sse') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(': ready\n\n'); return;
    }
    active++; maximum = Math.max(maximum, active);
    setTimeout(() => { active--; response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'); }, 10);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`, client = boundedHttpClient(base, 2);
  t.after(() => client.close());
  const controllers = Array.from({ length: 20 }, () => new AbortController());
  t.after(() => controllers.forEach(c => c.abort()));
  await Promise.all(controllers.map(c => fetch(base + '/sse', { signal: c.signal })));
  controllers.forEach(c => c.abort());
  const values = await Promise.all(Array.from({ length: 20 }, async () =>
    (await client.fetch(base + '/command', { signal: AbortSignal.timeout(3000) })).json()));
  assert.ok(values.every(v => v.ok));
  assert.equal(maximum, 2);
  assert.throws(() => client.fetch('http://example.invalid'), /Cross-origin/);
});

test('network error diagnostics retain only a bounded code, never the request or token', () => {
  assert.equal(networkErrorCode({ cause: { code: 'EADDRNOTAVAIL', message: 'private token' } }), 'EADDRNOTAVAIL');
  assert.equal(networkErrorCode({ code: 'secret=anything' }), 'UNSPECIFIED');
});
