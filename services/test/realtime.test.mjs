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
    revoke: () => { allowed = false; }, outage: () => { unavailable = true; } };
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

test('revocation removes private stream and authority outage fails closed within lease', async () => {
  const f = fixture(), privateOutput = new Output(), publicOutput = new Output();
  await f.hub.addStudent('ABCDEF', 'person', privateOutput);
  await f.hub.addStudent('ABCDEF', '', publicOutput, true);
  f.revoke(); f.hub.tick(); await settle();
  assert.equal(privateOutput.destroyed, true);
  assert.equal(publicOutput.destroyed, false);
  const g = fixture(), output = new Output();
  await g.hub.addStudent('ABCDEF', 'person', output);
  g.outage(); g.advance(5000); g.hub.tick(); await settle();
  assert.equal(output.destroyed, true);
  assert.equal(g.hub.clients.size, 0);
  f.hub.close(); g.hub.close();
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
