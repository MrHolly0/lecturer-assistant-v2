import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { UpgradeAdmission } from '../realtime/upgrade-admission.mjs';
import { clientAddress } from '../common/client-address.mjs';
const key = 'isolated-upgrade-credential-00000000000000';
const session = '11111111-1111-4111-8111-111111111111';
const person = '22222222-2222-4222-8222-222222222222';
const ticket = (now = Date.now(), subject = person) => {
  const body = Buffer.from(JSON.stringify({ v: 1, session, person: subject, nonce: randomUUID(), expires: now + 20000 })).toString('base64url');
  return body + '.' + createHmac('sha256', key).update('presenter-upgrade-v1.' + body).digest('base64url');
};
const protocols = token => 'lecturer.v1, ticket.' + token;

test('source assertions require the private hop credential and an IP literal', () => {
  const request = { socket: { remoteAddress: '10.0.0.1' }, headers: {
    'x-lecturer-proxy-key': key, 'x-lecturer-client-ip': '192.0.2.1', 'x-forwarded-for': 'spoofed' } };
  assert.equal(clientAddress(request, key), '192.0.2.1');
  request.headers['x-lecturer-proxy-key'] = 'é'.repeat(key.length);
  assert.equal(clientAddress(request, key), '10.0.0.1');
  request.headers['x-lecturer-proxy-key'] = key;
  request.headers['x-lecturer-client-ip'] = 'untrusted.example';
  assert.equal(clientAddress(request, key), '10.0.0.1');
});

test('invalid upgrades spend no protected slots; pending, established and identity counters release exactly once', () => {
  let now = 100000;
  const admission = new UpgradeAdmission(key, { now: () => now, pendingLimit: 2, connectedLimit: 1, personLimit: 2 });
  for (let i = 0; i < 512; i++) assert.throws(() => admission.reserve(session, 'lecturer.v1'), e => e.status === 401);
  const signed = ticket(now);
  const a = admission.reserve(session, protocols(signed));
  assert.throws(() => admission.reserve(session, protocols(signed)), e => e.status === 401);
  const b = admission.reserve(session, protocols(ticket(now)));
  assert.equal(admission.pending, 2); a.promote();
  assert.equal(admission.connected, 1); assert.equal(admission.pending, 1);
  assert.throws(() => b.promote(), e => e.status === 503);
  assert.throws(() => admission.reserve(session, protocols(ticket(now))), e => e.status === 429);
  a.release(); a.release(); b.promote(); b.release(); b.release();
  assert.equal(admission.pending, 0); assert.equal(admission.connected, 0); assert.equal(admission.people.size, 0);
  now += 30000;
  assert.throws(() => admission.reserve(session, protocols(signed)), e => e.status === 401);
  assert.throws(() => admission.reserve(session, protocols(ticket(now) + 'x')), e => e.status === 401);
  assert.throws(() => admission.reserve(randomUUID(), protocols(ticket(now))), e => e.status === 401);
});

test('actual gateway admits a new presenter after hundreds of unauthenticated HTTP upgrades', { timeout: 15000 }, async () => {
  const core = createServer(async (request, response) => {
    for await (const _ of request) { /* Drain the fixture RPC. */ }
    const checkedAt = new Date(), expiresAt = new Date(checkedAt.getTime() + 5000);
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      personId: person, session: { id: session, joinCode: 'TEST', status: 'LIVE', version: 1 }, checkedAt, expiresAt
    }));
  });
  core.listen(0, '127.0.0.1'); await once(core, 'listening');
  const portHolder = createServer(); portHolder.listen(0, '127.0.0.1'); await once(portHolder, 'listening');
  const port = portHolder.address().port; await new Promise(resolve => portHolder.close(resolve));
  const child = spawn(process.execPath, [new URL('../realtime/index.mjs', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), CORE_URL: `http://127.0.0.1:${core.address().port}`,
      SERVICE_REALTIME_KEY: key, AMQP_URL: 'amqp://127.0.0.1:1', DRAIN_WINDOW_MS: '0' }, stdio: 'ignore'
  });
  let presenter;
  try {
    for (let n = 0; ; n++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* Wait for the fixture listener. */ }
      if (n > 100) throw new Error('Gateway did not start');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const url = `ws://127.0.0.1:${port}/ws/session/${session}`;
    const rejected = () => new Promise((resolve, reject) => {
      const socket = new WebSocket(url); socket.on('error', () => {});
      socket.once('unexpected-response', (_, response) => { response.resume(); resolve(response.statusCode); });
      socket.once('open', () => { socket.terminate(); reject(new Error('Unauthenticated upgrade accepted')); });
    });
    for (let batch = 0; batch < 20; batch++) assert.ok((await Promise.all(Array.from({ length: 16 }, rejected))).every(status => [401, 429].includes(status)));
    presenter = new WebSocket(url, ['lecturer.v1', 'ticket.' + ticket()]);
    await once(presenter, 'open');
    const frame = new Promise((resolve, reject) => {
      presenter.once('message', message => resolve(message));
      presenter.once('close', code => reject(new Error('Presenter closed: ' + code)));
      presenter.once('error', reject);
    });
    presenter.send('CONNECT\nAuthorization:Bearer fixture\n\n\0');
    assert.match(String(await frame), /^CONNECTED/);
  } finally {
    presenter?.terminate(); if (child.exitCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    core.closeAllConnections();
    await new Promise(resolve => core.close(resolve));
  }
});
