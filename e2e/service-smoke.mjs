// Only a fresh private lab. The fixture file is private; reports contain no credentials.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { WebSocket } from '../services/node_modules/ws/wrapper.mjs';
const base = process.env.SCALE_BASE_URL ?? 'http://localhost:18089';
const parsed = new URL(base);
if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(parsed.hostname)
    || process.env.SCALE_LAB !== 'true') throw new Error('Explicit local lab required');
const fixturePath = process.env.SCALE_FIXTURE_FILE ?? '/private/tmp/lecturer-scale-fixture.json';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(method, path, token, body, headers = {}) {
  const response = await fetch(new URL('/api/v1' + path, base), { method, signal: AbortSignal.timeout(10000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${response.status}: ${method} ${path}: `
      + String(detail.message ?? '').slice(0, 180)), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}
let fixture;
try { fixture = JSON.parse(await readFile(fixturePath)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!fixture) {
  fixture = { email: `scale-${randomUUID()}@example.invalid`, password: randomUUID() + randomUUID() };
  const admin = await api('POST', '/auth/bootstrap-admin', null, { displayName: 'Scale Lab Admin',
    email: fixture.email, password: fixture.password }, { 'X-Admin-Setup-Token': process.env.ADMIN_SETUP_TOKEN });
  fixture.token = admin.accessToken;
  // Persist before later steps so an interrupted first setup can log in again.
  await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 }); await chmod(fixturePath, 0o600);
}
fixture.token = (await api('POST', '/auth/login', null, { email: fixture.email, password: fixture.password })).accessToken;
const token = fixture.token;
if (!fixture.course) fixture.course = await api('POST', '/courses', token, { title: 'Isolated service verification' });
const root = `/courses/${fixture.course.id}`;
if (!fixture.deck) {
  const form = new FormData(); form.set('title', 'Scale golden PDF');
  form.set('file', new Blob([await readFile('core/src/test/resources/golden/content/v1-report.pdf')],
    { type: 'application/pdf' }), 'golden.pdf');
  const job = await api('POST', root + '/decks', token, form);
  let imported;
  for (let i = 0; i < 120; i++) {
    imported = await api('GET', root + '/import-jobs/' + job.id, token);
    if (imported.status === 'COMPLETED') break;
    if (['FAILED', 'PARTIAL'].includes(imported.status)) throw new Error('Import worker failed');
    await sleep(500);
  }
  assert.equal(imported.status, 'COMPLETED');
  fixture.deck = await api('GET', root + '/decks/' + imported.deckId, token);
}
if (!fixture.lecture) fixture.lecture = await api('POST', root + '/lectures', token,
  { title: 'Service smoke', deckId: fixture.deck.id });
if (fixture.session) {
  const current = await api('GET', root + '/sessions/' + fixture.session.id, token);
  if (['ENDED', 'ARCHIVED', 'CANCELLED'].includes(current.status)) {
    fixture.session = null; fixture.students = [];
  }
}
if (!fixture.session) {
  fixture.session = await api('POST', root + '/lectures/' + fixture.lecture.id + '/sessions', token,
    { groups: [{ groupName: 'Service lab' }] });
  await api('POST', root + '/sessions/' + fixture.session.id + '/begin', token);
}
const sessionRoot = root + '/sessions/' + fixture.session.id;
fixture.students ??= [];
for (let i = fixture.students.length; i < 3; i++) fixture.students.push(await api('POST',
  `/student/sessions/${fixture.session.joinCode}/join`, null, { displayName: `Lab student ${i}` }));
await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 }); await chmod(fixturePath, 0o600);
const controller = new AbortController(), frames = [];
const source = await fetch(new URL(`/api/v1/student/sessions/${fixture.session.joinCode}/events?`
  + new URLSearchParams({ participantToken: fixture.students[0].participantToken }), base), { signal: controller.signal });
assert.equal(source.status, 200);
const receiving = (async () => {
  let buffer = '';
  try {
    for await (const chunk of source.body) {
      buffer += new TextDecoder().decode(chunk);
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (frame.startsWith('event: snapshot')) frames.push(JSON.parse(frame.split('\ndata: ')[1]));
      }
    }
  } catch (error) { if (!controller.signal.aborted) throw error; }
})();
const ws = new WebSocket(new URL(`/ws/session/${fixture.session.id}`, base.replace('http:', 'ws:')));
const messages = [];
ws.on('message', bytes => {
  const text = bytes.toString(); messages.push(text);
  if (text.startsWith('CONNECTED')) ws.send(`SUBSCRIBE\nid:session\ndestination:/topic/session/${fixture.session.id}\n\n\0`);
});
ws.on('open', () => ws.send(`CONNECT\naccept-version:1.2\nAuthorization:Bearer ${token}\nheart-beat:10000,10000\n\n\0`));
try {
  let current = await api('GET', sessionRoot, token);
  if (current.status === 'PAUSED') current = await api('POST', sessionRoot + '/resume', token);
  const started = Date.now();
  // A real mutation prevents an initial snapshot from satisfying the delivery check.
  const changed = await api('POST', sessionRoot + '/pause', token);
  const updatedMessage = m => m.startsWith('MESSAGE') && m.includes(`"version":${changed.version}`);
  const until = Date.now() + 3000;
  while (Date.now() < until && (!frames.some(s => s.version >= changed.version)
      || !messages.some(updatedMessage))) await sleep(25);
  assert.ok(frames.some(s => s.sessionId === fixture.session.id && s.version >= changed.version), 'SSE delivery');
  assert.ok(messages.some(updatedMessage), 'STOMP delivery');
  const deliveryMs = Date.now() - started;
  await api('POST', sessionRoot + '/resume', token);
  const question = await api('POST', `/student/sessions/${fixture.session.joinCode}/questions`, null,
    { participantToken: fixture.students[0].participantToken, text: 'Private lab question ' + randomUUID(),
      anonymous: true });
  const secretAnswer = 'author-only-' + randomUUID();
  await api('PUT', sessionRoot + '/questions/' + question.id, token,
    { status: 'ANSWERED', answerText: secretAnswer, answerVisibility: 'AUTHOR' });
  const privateUntil = Date.now() + 3000;
  while (Date.now() < privateUntil && !frames.some(s => JSON.stringify(s.questionAnswers).includes(secretAnswer)))
    await sleep(25);
  assert.ok(frames.some(s => JSON.stringify(s.questionAnswers).includes(secretAnswer)), 'Private SSE answer');
  for (const participant of [null, fixture.students[1]]) {
    const snapshot = await api('GET', `/student/sessions/${fixture.session.joinCode}`, null, undefined,
      participant ? { 'X-Participant-Token': participant.participantToken } : {});
    assert.ok(!JSON.stringify(snapshot).includes(secretAnswer), 'Private answer isolation');
  }
  const capabilities = await api('GET', '/media/capabilities'); assert.equal(capabilities.provider, 'sfu');
  const room = await api('POST', sessionRoot + '/sfu-share', token, { sourceName: 'Lab synthetic screen' });
  try {
    let publisher;
    // Issuing this same publisher grant is idempotent. A supervisor can still be warming after API restart.
    for (let i = 0; i < 40; i++) {
      try { publisher = await api('POST', sessionRoot + '/sfu-share/' + room.id + '/ticket', token); break; }
      catch (error) { if (error.status !== 503 || i === 39) throw error; await sleep(500); }
      await api('GET', sessionRoot + '/sfu-share/' + room.id, token);
    }
    const viewer = await api('POST', `/student/sessions/${fixture.session.joinCode}/sfu-share/${randomUUID()}`,
      null, undefined, { 'X-Participant-Token': fixture.students[0].participantToken });
    assert.ok(publisher.token); assert.ok(viewer.ticket.token);
    const pub = JSON.parse(Buffer.from(publisher.token.split('.')[1], 'base64url'));
    const sub = JSON.parse(Buffer.from(viewer.ticket.token.split('.')[1], 'base64url'));
    assert.equal(pub.video.canPublish, true); assert.equal(sub.video.canPublish, false);
    assert.equal(sub.video.canPublishData, false);
  } finally { await api('DELETE', sessionRoot + '/sfu-share/' + room.id, token); }
  const internal = await fetch(new URL('/internal/v1/events/outbox/claim', base), { method: 'POST' });
  assert.equal(internal.status, 404);
  let analytics = false;
  if (process.env.SCALE_END_SESSION === 'true') {
    await api('POST', sessionRoot + '/end', token);
    const deadline = Date.now() + 20000;
    let report;
    while (Date.now() < deadline) {
      const response = await fetch(new URL('/api/v1' + sessionRoot + '/summary', base),
        { headers: { Authorization: 'Bearer ' + token } });
      if (response.ok) { report = await response.json(); break; }
      assert.equal(response.status, 503); await response.body?.cancel(); await sleep(500);
    }
    assert.equal(report?.sessionId, fixture.session.id, 'Isolated analytics projection');
    assert.ok(report.participants.length >= 3); analytics = true;
  }
  console.log(JSON.stringify({ passed: true, importWorker: true, deliveryMs, sseSnapshots: frames.length,
    stompMessages: messages.filter(m => m.startsWith('MESSAGE')).length, sfuGrants: true,
    privateAnswer: true, internalBlocked: true, analytics }));
} finally { controller.abort(); ws.terminate(); await receiving; }
