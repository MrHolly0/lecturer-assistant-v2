import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RealtimeHub } from '../realtime/hub.mjs';
import { attachStomp } from '../realtime/stomp.mjs';
import { publishClaims } from '../common/broker.mjs';

const sessionId = '00000000-0000-4000-8000-000000000001';
const settle = () => new Promise(resolve => setImmediate(resolve));
class Output extends EventEmitter {
  frames = []; writableLength = 0; blocked = false; destroyed = false;
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(frame) { this.frames.push(frame); return !this.blocked; }
  end() { this.destroyed = true; this.emit('close'); }
  destroy() { this.end(); }
}
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; frames = [];
  send(frame) { this.frames.push(frame); }
  close(code) { this.code = code; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(1006); }
}
function fixture(options = {}) {
  let time = 100000, version = 1, allowed = true, unavailable = false;
  const calls = [];
  const snapshot = person => ({ sessionId, version, status: 'LIVE', questionAnswers: [person] });
  const rpc = async (path, body) => {
    calls.push({ path, body });
    if (unavailable) throw new Error('authority unavailable');
    const expiresAt = new Date(time + 5000).toISOString();
    if (path.endsWith('student-grant')) return {
      personId: body.participantToken, authVersion: 1, expiresAt, permissionDeadline: time + 4750,
      snapshot: snapshot(body.participantToken)
    };
    if (path.endsWith('student-batch')) return { expiresAt, permissionDeadline: time + 4750,
      allowed: allowed ? body.subjects.map(s => s.personId) : [],
      shared: snapshot('public'), oversized: [],
      overlays: Object.fromEntries(body.subjects.map(s => [s.personId, { questionAnswers: [s.personId] }])) };
    if (path.endsWith('public-snapshot')) return { ...snapshot('public'), questionAnswers: [] };
    if (path.endsWith('presenter-grant')) return { expiresAt, permissionDeadline: time + 4750,
      session: { id: sessionId, joinCode: 'ABCDEF', version } };
    return {};
  };
  const hub = new RealtimeHub(rpc, { now: () => time, ...options });
  return { hub, calls, advance: ms => { time += ms; }, change: () => { version++; },
    revoke: () => { allowed = false; }, outage: () => { unavailable = true; },
    restore: () => { unavailable = false; } };
}

test('6,000 connections share batched authority reads and preserve personal answers', async () => {
  const f = fixture();
  for (let i = 0; i < 6000; i++) await f.hub.addStudent('ABCDEF', `person-${i}`, new Output());
  await assert.rejects(f.hub.addStudent('ABCDEF', 'excess', new Output()), { status: 503 });
  f.calls.length = 0; f.change();
  f.hub.invalidate({ schemaVersion: 1, sessionId, type: 'session.changed' });
  f.hub.tick(); await settle();
  assert.equal(f.calls.filter(c => c.path.endsWith('student-batch')).length, 47);
  for (const client of f.hub.clients) {
    assert.match(client.response.frames.at(-1), new RegExp(`"questionAnswers":\\["${client.personId}"\\]`));
    assert.equal(client.pending, null);
  }
  assert.equal(f.hub.rooms.size, 1);
  f.hub.close();
});

test('connection burst cannot consume unbounded authority work reserved for renewals', async () => {
  let release;
  const rpc = async () => new Promise(resolve => { release = resolve; });
  const hub = new RealtimeHub(rpc, { grantConcurrency: 1 });
  const pending = hub.addStudent('ABCDEF', '', new Output(), true);
  await assert.rejects(hub.addStudent('ABCDEF', '', new Output(), true), { status: 503 });
  assert.equal(hub.pendingGrants, 1);
  release({ sessionId, status: 'LIVE', version: 1 }); await pending;
  assert.equal(hub.pendingGrants, 0);
  hub.close();
});

test('revocation closes immediately; authority outage suspends delivery then closes at recovery deadline', async () => {
  const f = fixture(), privateOutput = new Output(), publicOutput = new Output();
  await f.hub.addStudent('ABCDEF', 'person', privateOutput);
  await f.hub.addStudent('ABCDEF', '', publicOutput, true);
  f.revoke(); f.hub.tick(); await settle();
  assert.equal(privateOutput.destroyed, true);
  assert.equal(publicOutput.destroyed, false);
  const g = fixture(), output = new Output();
  await g.hub.addStudent('ABCDEF', 'person', output);
  g.outage(); g.advance(5000); g.hub.tick(); await settle();
  assert.equal(output.destroyed, false);
  assert.equal(g.hub.stats.suspended, 1);
  const frames = output.frames.length;
  g.hub.snapshot([...g.hub.clients][0], { version: 99, secret: 'forbidden' });
  assert.equal(output.frames.length, frames);
  g.advance(30000); g.hub.tick(); await settle();
  assert.equal(output.destroyed, true);
  assert.equal(g.hub.clients.size, 0);
  assert.equal(g.hub.stats.suspended, 0);
  assert.equal(g.hub.stats.recoveryTimeouts, 1);
  f.hub.close(); g.hub.close();
});

test('process pause reauthorizes the same sockets and sends only current private state', async () => {
  const f = fixture(), a = new Output(), b = new Output(), socket = new Socket();
  const ca = await f.hub.addStudent('ABCDEF', 'a', a);
  await f.hub.addStudent('ABCDEF', 'b', b);
  const presenter = await f.hub.addPresenter(sessionId, 'fixture', socket);
  presenter.subscription = 'session';
  f.advance(10000); f.change(); f.hub.tick();
  assert.equal(f.hub.stats.suspended, 3);
  assert.equal(a.frames.length, 1);
  assert.equal(socket.frames.length, 0);
  await settle();
  assert.equal(f.hub.clients.size, 3);
  assert.equal(f.hub.stats.suspended, 0);
  assert.equal(f.hub.stats.resumed, 3);
  assert.equal(a.destroyed, false);
  assert.match(a.frames.at(-1), /"version":2/);
  assert.match(a.frames.at(-1), /"questionAnswers":\["a"\]/);
  assert.doesNotMatch(a.frames.at(-1), /"questionAnswers":\["b"\]/);
  assert.match(socket.frames.at(-1), /"version":2/);
  assert.equal(presenter.initialSession, undefined);
  assert.equal(f.hub.valid(ca), true);
  f.hub.close();
});

test('buffered private frames and stale replies never bypass expired permission', async () => {
  const f = fixture(), output = new Output(); output.blocked = true;
  const client = await f.hub.addStudent('ABCDEF', 'person', output);
  f.hub.snapshot(client, { version: 2, private: 'old' });
  assert.ok(client.pending);
  f.outage(); f.advance(6000); f.hub.tick(); await settle();
  assert.equal(client.pending, null);
  output.blocked = false; output.emit('drain');
  assert.equal(output.frames.length, 1);
  const deadline = client.recoveryDeadline;
  f.advance(1000);
  assert.equal(f.hub.renew(client, { permissionDeadline: 0 }), false);
  assert.equal(client.recoveryDeadline, deadline);
  f.revoke(); f.restore(); f.hub.tick(); await settle();
  assert.equal(output.destroyed, true);
  assert.equal(output.frames.length, 1);
  f.hub.close();
});

test('late successful renewal cannot resurrect a socket beyond its fixed recovery budget', async () => {
  const f = fixture(), output = new Output();
  const client = await f.hub.addStudent('ABCDEF', 'person', output);
  f.outage(); f.advance(6000); f.hub.tick(); await settle();
  f.advance(30000);
  assert.equal(f.hub.renew(client, { permissionDeadline: 999999 }), false);
  assert.equal(output.destroyed, true);
  assert.equal(f.hub.stats.resumed, 0);
});

test('slow authority work schedules the next renewal before the actual lease deadline', async () => {
  let now = 100000;
  const rpc = async path => {
    const permissionDeadline = now + 4750;
    if (path.endsWith('student-grant')) return {
      personId: 'person', authVersion: 1, permissionDeadline,
      snapshot: { sessionId, status: 'LIVE', version: 1 }
    };
    now += 1800;
    return { permissionDeadline, allowed: ['person'], oversized: [], overlays: {} };
  };
  const hub = new RealtimeHub(rpc, { now: () => now });
  const client = await hub.addStudent('ABCDEF', 'token', new Output());
  client.room.dirty = false; client.room.lastSnapshot = now;
  hub.tick(); await settle();
  assert.ok(client.room.due <= client.expiresAt - 2000);
  assert.equal(hub.stats.suspended, 0);
  hub.close();
});

test('authority outage backs off per room instead of retrying every scheduler tick', async () => {
  const f = fixture();
  await f.hub.addStudent('ABCDEF', 'person', new Output());
  f.outage();
  const room = [...f.hub.rooms.values()][0];
  for (let i = 0; i < 4; i++) {
    f.hub.tick(); await settle();
    assert.equal(room.failures, i + 1);
    const calls = f.calls.length;
    f.hub.invalidate({ schemaVersion: 1, sessionId, type: 'changed' });
    f.advance(100); f.hub.tick(); await settle();
    assert.equal(f.calls.length, calls);
    f.advance(2000);
  }
  f.restore(); f.hub.tick(); await settle();
  assert.equal(room.failures, 0);
  assert.equal(f.hub.clients.size, 1);
  f.hub.close();
});

test('draining rejects new grants and migrates existing connections gradually with fresh authorization', async () => {
  const f = fixture(), outputs = [];
  for (let i = 0; i < 20; i++) {
    const output = new Output(); outputs.push(output);
    await f.hub.addStudent('ABCDEF', `person-${i}`, output);
  }
  const socket = new Socket(); await f.hub.addPresenter(sessionId, 'fixture', socket);
  let sample = 0;
  f.hub.startDrain(2000, () => sample++ / 21);
  await assert.rejects(f.hub.addStudent('ABCDEF', 'new', new Output()), { status: 503 });
  assert.equal(f.hub.clients.size, 21);
  f.change(); f.hub.invalidate({ schemaVersion: 1, sessionId, type: 'changed' });
  f.advance(500); f.hub.tick(); await settle();
  assert.ok(f.hub.clients.size > 0 && f.hub.clients.size < 21);
  assert.match(outputs.at(-1).frames.at(-1), /"version":2/);
  f.advance(2000); f.hub.tick(); await settle();
  assert.equal(f.hub.clients.size, 0);
  assert.equal(f.hub.stats.drained, 21);
  assert.equal(f.hub.stats.revoked, 0);
  assert.equal(socket.code, 1012);
});

test('a grant requested before drain cannot admit a connection after drain begins', async () => {
  let release;
  const hub = new RealtimeHub(async () => new Promise(resolve => { release = resolve; }));
  const output = new Output(), pending = hub.addStudent('ABCDEF', '', output, true);
  hub.startDrain(1000);
  release({ sessionId, status: 'LIVE', version: 1 });
  await assert.rejects(pending, { status: 503 });
  assert.equal(hub.clients.size, 0);
  assert.equal(output.frames.length, 0);
  assert.equal(hub.pendingGrants, 0);
  hub.close();
});

test('slow SSE retains only latest frame and oversized snapshots send invalidations', async () => {
  const f = fixture({ maxFrameBytes: 512 }), output = new Output(); output.blocked = true;
  const client = await f.hub.addStudent('ABCDEF', 'person', output);
  for (let i = 0; i < 100; i++) f.hub.snapshot(client, { version: i, status: 'LIVE' });
  assert.equal(output.frames.length, 1);
  assert.match(client.pending, /"version":99/);
  output.blocked = false; output.emit('drain');
  assert.equal(output.frames.length, 2);
  f.hub.snapshot(client, { sessionId, version: 100, status: 'LIVE', secret: 'x'.repeat(20000) });
  assert.match(output.frames.at(-1), /^event: invalidate/);
  assert.doesNotMatch(output.frames.at(-1), /secret/);
  output.writableLength = 40000;
  f.hub.snapshot(client, { version: 101, status: 'LIVE' });
  assert.equal(output.destroyed, true);
  assert.equal(f.hub.stats.slowConsumers, 1);
});

test('event during an in-flight refresh is retained, duplicate invalidations do not duplicate snapshots', async () => {
  const f = fixture(), output = new Output();
  await f.hub.addStudent('ABCDEF', 'person', output);
  f.hub.tick();
  f.hub.invalidate({ schemaVersion: 1, sessionId, type: 'changed' });
  await settle();
  assert.equal([...f.hub.rooms.values()][0].dirty, true);
  f.advance(250); f.hub.tick(); await settle();
  assert.equal(output.frames.length, 1);
  f.change(); f.hub.invalidate({ schemaVersion: 1, sessionId, type: 'changed' });
  f.hub.tick(); await settle();
  assert.equal(output.frames.length, 2);
  f.hub.close();
});

test('STOMP allows one scoped subscription and rejects browser-side commands', async () => {
  const f = fixture(), socket = new Socket();
  attachStomp(socket, sessionId, f.hub);
  socket.emit('message', Buffer.from('CONNECT\nAuthorization:Bearer fixture\n\n\0'));
  await settle();
  socket.emit('message', Buffer.from(`SUBSCRIBE\nid:session\ndestination:/topic/session/${sessionId}\n\n\0`));
  await settle();
  assert.match(socket.frames[0], /^CONNECTED/);
  assert.match(socket.frames[1], /^MESSAGE/);
  socket.emit('message', Buffer.from('SEND\ndestination:/topic/session/any\n\n{}\0'));
  await settle();
  assert.equal(socket.code, 1008);
  assert.equal(f.hub.clients.size, 0);
});

test('STOMP wildcard subscription is rejected without delivering lecture data', async () => {
  const f = fixture(), socket = new Socket();
  attachStomp(socket, sessionId, f.hub);
  socket.emit('message', Buffer.from('CONNECT\nAuthorization:Bearer fixture\n\n\0'));
  await settle();
  socket.emit('message', Buffer.from('SUBSCRIBE\nid:x\ndestination:/topic/session/*\n\n\0'));
  await settle();
  assert.equal(socket.code, 1008);
  assert.equal(socket.frames.filter(f => f.startsWith('MESSAGE')).length, 0);
});

test('STOMP retries an unavailable authority but preserves explicit access denial', async () => {
  for (const [status, expected] of [[undefined, 1013], [503, 1013], [403, 1008]]) {
    const f = fixture(), socket = new Socket();
    f.hub.rpc = async () => { throw Object.assign(new Error('Unavailable'), { status }); };
    attachStomp(socket, sessionId, f.hub);
    socket.emit('message', Buffer.from('CONNECT\nAuthorization:Bearer fixture\n\n\0'));
    await settle();
    assert.equal(socket.code, expected);
    assert.equal(f.hub.clients.size, 0);
  }
});

test('publisher requires broker confirm and durable routing but tolerates missing transient subscribers', async () => {
  const channel = new EventEmitter();
  channel.publish = (exchange, key, payload, properties, callback) => {
    channel.emit('return', { properties }); callback(null);
  };
  const claims = ['domain.session.ended', 'realtime.session.ended'].map((routingKey, i) => ({
    id: `${i}`, claimToken: 'lease', payload: '{}', routingKey
  }));
  assert.deepEqual((await publishClaims(channel, claims)).map(a => a.delivered), [false, true]);
  channel.publish = (...args) => args.at(-1)(new Error('broker rejected'));
  assert.deepEqual((await publishClaims(channel, claims)).map(a => a.delivered), [false, false]);
  assert.equal(channel.listenerCount('return'), 0);
});
