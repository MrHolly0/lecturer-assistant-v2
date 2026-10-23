#!/usr/bin/env node
// Isolated full-path capacity exercise. Credentials stay in memory; reports contain counts only.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const base = new URL(process.env.BASE_URL || 'http://caddy');
const privateV4 = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const privateHost = /^(localhost|caddy|capacity-caddy|host\.docker\.internal|\[::1\])$/;
if (process.env.CAPACITY_ISOLATED !== 'true' || base.protocol !== 'http:' ||
    (!privateHost.test(base.hostname) && !privateV4.test(base.hostname)) || base.username || base.password) {
  throw new Error('Requires CAPACITY_ISOLATED=true and an HTTP loopback/private Docker BASE_URL. Public hosts are forbidden.');
}
if (!process.env.ADMIN_SETUP_TOKEN) throw new Error('An isolated ADMIN_SETUP_TOKEN is required.');
const plan = (process.env.CAPACITY_STAGES || '1x30,10x30,25x30,100x30,10x150').split(',').map(text => {
  if (!/^\d+x\d+$/.test(text)) throw new Error('Stages must have the form lectures x students, e.g. 10x30.');
  const [lectures, students] = text.split('x').map(Number);
  if (lectures < 1 || lectures > 100 || students < 1 || students > 150) throw new Error('Stage exceeds the safety bound 100x150.');
  return { lectures, students };
});
const runId = randomUUID();
const output = resolve(process.env.CAPACITY_OUTPUT || `artifacts/system-capacity-${Date.now()}`);
const fixture = await readFile(resolve(process.env.CAPACITY_PDF || 'core/src/test/resources/golden/content/v1-report.pdf'));
const requestTimeout = Number(process.env.CAPACITY_REQUEST_TIMEOUT_MS || 15000);
const stageTimeout = Number(process.env.CAPACITY_STAGE_TIMEOUT_MS || 90000);
const pngBudget = Number(process.env.CAPACITY_PNG_P95_MS || 5000);
const deliveryBudget = Number(process.env.CAPACITY_DELIVERY_P95_MS || 2000);
const joinConcurrency = Number(process.env.CAPACITY_JOIN_CONCURRENCY || 16);
const openConcurrency = Number(process.env.CAPACITY_OPEN_CONCURRENCY || 32);
const ioConcurrency = Number(process.env.CAPACITY_IO_CONCURRENCY || 32);
for (const value of [joinConcurrency, openConcurrency, ioConcurrency]) {
  if (!Number.isInteger(value) || value < 1 || value > 128) throw new Error('Concurrency must be within 1..128.');
}
const summary = { runId, base: base.origin, startedAt: new Date().toISOString(),
  revision: process.env.REVISION || null, path: 'client -> Caddy -> core -> PostgreSQL',
  mediaIncluded: false, plan, stages: [], setup: {}, passed: false };
const stats = { requests: 0, retries: 0, statuses: {}, networkFailures: 0 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ratio = (actual, expected) => expected ? actual / expected : 0;
const percentile = (values, percent) => values.length ? [...values].sort((a,b) => a-b)[Math.ceil(values.length * percent)-1] : null;
const log = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const progress = setInterval(() => log({ progress: true, requests: stats.requests,
  completedStages: summary.stages.length, retries: stats.retries }), 20000);
function retryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now()) || 0;
}
class HttpFailure extends Error {
  constructor(status) { super(`HTTP ${status}`); this.status = status; }
}
async function request(method, path, options = {}) {
  const headers = { ...options.headers };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.key) headers['Idempotency-Key'] = options.key;
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    let response;
    try {
      response = await fetch(new URL(path, base), { method, headers, body,
        signal: AbortSignal.timeout(requestTimeout), redirect: 'error' });
      stats.requests++;
      stats.statuses[response.status] = (stats.statuses[response.status] || 0) + 1;
    } catch {
      stats.networkFailures++;
      // A failed unkeyed create may already have committed. Never repeat it blindly.
      if (attempt < 3 && (method === 'GET' || options.key || options.idempotent)) {
        stats.retries++; await sleep(Math.random() * Math.min(5000, 500 * 2 ** attempt)); continue;
      }
      throw new Error('Request transport failure');
    }
    const safeRetry = method === 'GET' || options.key || options.idempotent || response.status === 429;
    if (attempt < 6 && safeRetry && [429, 502, 503, 504].includes(response.status)) {
      const delay = Math.max(retryAfter(response.headers.get('Retry-After')), Math.random() * Math.min(5000, 500 * 2 ** attempt));
      await response.body?.cancel();
      if (delay > 180000) throw new Error('Retry-After exceeds the bounded test budget');
      stats.retries++; await sleep(delay); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new HttpFailure(response.status); }
    if (options.binary) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.headers.get('Content-Type')?.startsWith('image/png') ||
          bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) {
        throw new Error('Invalid slide PNG');
      }
      return { size: bytes.length, duration: performance.now() - started };
    }
    if (response.status === 204) return null;
    return response.json();
  }
}
async function pool(items, concurrency, fn) {
  let next = 0;
  return Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; await fn(items[index], index); }
  }));
}
class WorkQueue {
  constructor(max) { this.max = max; this.running = 0; this.maximum = 0; this.tasks = []; this.waiters = []; }
  add(fn) { this.tasks.push(fn); this.pump(); }
  pump() {
    while (this.running < this.max && this.tasks.length) {
      const fn = this.tasks.shift(); this.running++; this.maximum = Math.max(this.maximum, this.running);
      Promise.resolve().then(fn).finally(() => { this.running--; this.pump(); });
    }
    if (!this.running && !this.tasks.length) this.waiters.splice(0).forEach(resolve => resolve());
  }
  async drain() { if (this.running || this.tasks.length) await new Promise(resolve => this.waiters.push(resolve)); }
}
async function waitUntil(predicate, timeout = stageTimeout) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (predicate()) return true; await sleep(50); }
  return predicate();
}
const intent = () => randomUUID();
let admin;
let course;
let deck;
let teacherFixtures = [];
async function setup(count) {
  const started = performance.now();
  const password = `Capacity-${randomUUID()}`;
  admin = await request('POST', '/api/v1/auth/bootstrap-admin', {
    headers: { 'X-Admin-Setup-Token': process.env.ADMIN_SETUP_TOKEN },
    body: { displayName: 'Capacity Admin', email: `capacity-${runId}@example.invalid`, password } });
  course = await request('POST', '/api/v1/courses', { token: admin.accessToken, key: intent(), body: { title: `Capacity ${runId}` } });
  const form = new FormData(); form.set('title', 'Capacity golden PDF'); form.set('file', new Blob([fixture], { type: 'application/pdf' }), 'capacity.pdf');
  const job = await request('POST', `/api/v1/courses/${course.id}/decks`, { token: admin.accessToken, key: intent(), body: form });
  let imported;
  for (let attempt = 0; attempt < 240; attempt++) {
    imported = await request('GET', `/api/v1/courses/${course.id}/import-jobs/${job.id}`, { token: admin.accessToken });
    if (imported.status === 'COMPLETED') break;
    if (['FAILED','PARTIAL'].includes(imported.status)) throw new Error('Golden PDF import failed');
    await sleep(500);
  }
  if (imported.status !== 'COMPLETED') throw new Error('Golden PDF import timed out');
  deck = await request('GET', `/api/v1/courses/${course.id}/decks/${imported.deckId}`, { token: admin.accessToken });
  await pool(Array.from({ length: count }, (_, i) => i), 3, async i => {
    const invitation = await request('POST', '/api/v1/admin/invitations', { token: admin.accessToken, body: { role: 'LECTURER' } });
    const teacher = await request('POST', '/api/v1/auth/register', { body: { invitationCode: invitation.code,
      displayName: `Capacity Teacher ${i}`, email: `capacity-${runId}-${i}@example.invalid`, password } });
    await request('POST', `/api/v1/courses/${course.id}/members`, { token: admin.accessToken,
      body: { personId: teacher.user.id, role: 'LECTURER' } });
    const lecture = await request('POST', `/api/v1/courses/${course.id}/lectures`, {
      token: teacher.accessToken, key: intent(), body: { title: `Capacity Lecture ${i}`, deckId: deck.id } });
    teacherFixtures[i] = { teacher, lecture };
  });
  summary.setup = { teachers: count, slides: deck.slides.length, durationMs: Math.round(performance.now() - started) };
}
async function stage(configuration) {
  const started = performance.now();
  const expected = configuration.lectures * configuration.students;
  const result = { ...configuration, expectedClients: expected, joined: 0, sseInitial: 0, reconnected: 0,
    privacyErrors: 0, streamErrors: 0, scopeDenials: { expected: configuration.lectures > 1 ? configuration.lectures : 0, received: 0 }, images: { expected: expected * deck.slides.length, received: 0, bytes: 0 },
    delivery: [], fallback: { expected: expected * 3, received: 0, maximumPerClientInflight: 0 },
    votes: { expected, accepted: 0, duplicateRejected: 0, closedTotal: 0 }, feedbackVerified: 0,
    failures: [], passed: false };
  const imageMs = [];
  const imageQueue = new WorkQueue(ioConcurrency);
  const sessions = [];
  const clients = [];
  const issue = (step, error) => { if (result.failures.length < 30) result.failures.push({ step, error: error instanceof HttpFailure ? `HTTP ${error.status}` : error.message }); };
  function inspect(client, snapshot) {
    if (snapshot.sessionId !== client.session.id || snapshot.joinCode !== client.session.joinCode || snapshot.courseId !== course.id) {
      result.privacyErrors++; return;
    }
    if ((snapshot.myQuestions || []).some(question => question.id !== client.questionId &&
          !(client.number === 0 && question.text === `Private ${runId}`)) ||
        (snapshot.questionAnswers || []).some(answer => answer.answerVisibility === 'AUTHOR' && answer.questionId !== client.questionId)) result.privacyErrors++;
    if (snapshot.activePoll?.status === 'OPEN' && (snapshot.activePoll.correctOptionIdx != null || snapshot.activePoll.votes != null)) result.privacyErrors++;
    client.snapshot = snapshot;
    if (client.generation > 0) client.generationSeen = client.generation;
    if (client.changeStarted && snapshot.currentSlideIdx === client.expectedSlide && !client.deliveryRecorded) {
      client.deliveryRecorded = true; client.deliveryMs = performance.now() - client.changeStarted;
    }
    const image = snapshot.currentSlide;
    if (image?.imageUrl && !client.images.has(image.idx)) {
      client.images.add(image.idx);
      imageQueue.add(async () => {
        try {
          const downloaded = await request('GET', image.imageUrl, { binary: true });
          result.images.received++; result.images.bytes += downloaded.size; imageMs.push(downloaded.duration);
        } catch (error) { issue('png', error); }
      });
    }
  }
  async function open(client) {
    const controller = new AbortController(); client.controller = controller; client.generation++;
    const generation = client.generation;
    const untilHeaders = setTimeout(() => controller.abort(), requestTimeout);
    let response;
    try {
      response = await fetch(new URL(`/api/v1/student/sessions/${client.session.joinCode}/events?participantToken=${encodeURIComponent(client.token)}`, base), { signal: controller.signal, redirect: 'error' });
      clearTimeout(untilHeaders);
      if (!response.ok || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
        await response.body?.cancel(); throw new HttpFailure(response.status);
      }
    } catch (error) { clearTimeout(untilHeaders); issue('sse-open', error); return; }
    client.reader = (async () => {
      let buffer = ''; const decoder = new TextDecoder();
      try {
        for await (const bytes of response.body) {
          buffer = (buffer + decoder.decode(bytes, { stream: true })).replace(/\r\n/g, '\n');
          if (buffer.length > 4 * 1024 * 1024) throw new Error('Oversized SSE frame');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const value = JSON.parse(data);
            if (value.sessionId && value.joinCode) inspect(client, value);
            else if (value.answerVisibility === 'AUTHOR' && value.questionId !== client.questionId) result.privacyErrors++;
          }
        }
        if (!controller.signal.aborted && client.generation === generation) result.streamErrors++;
      } catch (error) { if (!controller.signal.aborted) { result.streamErrors++; issue('sse-read', error); } }
    })();
  }
  try {
    await pool(teacherFixtures.slice(0, configuration.lectures), 3, async ({teacher,lecture}, i) => {
      const session = await request('POST', `/api/v1/courses/${course.id}/lectures/${lecture.id}/sessions`, {
        token: teacher.accessToken, key: intent(), body: { groups: [{ groupName: `Capacity Group ${i}` }] } });
      await request('POST', `/api/v1/courses/${course.id}/sessions/${session.id}/begin`, { token: teacher.accessToken });
      sessions[i] = { ...session, teacher };
    });
    for (const session of sessions) for (let i = 0; i < configuration.students; i++) clients.push({ session, number: i, token: null,
      generation: 0, generationSeen: 0, images: new Set(), inflight: 0 });
    await pool(clients, joinConcurrency, async client => {
      try {
        const joined = await request('POST', `/api/v1/student/sessions/${client.session.joinCode}/join`, { body: { displayName: `Capacity Student ${client.number}` } });
        client.token = joined.participantToken; result.joined++; inspect(client, joined.snapshot);
      } catch (error) { issue('join', error); }
    });
    const joined = clients.filter(client => client.token);
    await pool(joined, openConcurrency, open);
    await waitUntil(() => joined.every(client => client.generationSeen === 1));
    result.sseInitial = joined.filter(client => client.generationSeen === 1).length;
    await imageQueue.drain();
    for (const slide of deck.slides.filter(slide => slide.idx > 1)) {
      joined.forEach(client => { client.expectedSlide = slide.idx; client.changeStarted = performance.now(); client.deliveryRecorded = false; });
      await pool(sessions, 8, async session => {
        // Set timestamp immediately before each lecture's command; setup time for other lectures is excluded.
        joined.filter(client => client.session.id === session.id).forEach(client => { client.changeStarted = performance.now(); });
        await request('PUT', `/api/v1/courses/${course.id}/sessions/${session.id}/slide`, { token: session.teacher.accessToken, body: { slideIdx: slide.idx } });
      });
      await waitUntil(() => joined.every(client => client.deliveryRecorded));
      const samples = joined.filter(client => client.deliveryRecorded).map(client => client.deliveryMs);
      result.delivery.push({ slideIdx: slide.idx, expected, received: samples.length, p95Ms: percentile(samples, .95) });
      await imageQueue.drain();
    }
    // Private answers must be delivered only to their author, also during reconnect and fallback reads.
    await pool(sessions, 8, async session => {
      const author = joined.find(client => client.session.id === session.id);
      if (!author) return;
      const question = await request('POST', `/api/v1/student/sessions/${session.joinCode}/questions`, { key: intent(),
        headers: { 'X-Participant-Token': author.token }, body: { participantToken: author.token, text: `Private ${runId}`, anonymous: true } });
      author.questionId = question.id;
      await request('PUT', `/api/v1/courses/${course.id}/sessions/${session.id}/questions/${question.id}`, {
        token: session.teacher.accessToken, body: { status: 'ANSWERED', answerText: `Only author ${runId}`, answerVisibility: 'AUTHOR' } });
    });
    await pool(sessions, 8, async (session, index) => {
      const publicSnapshot = await request('GET', `/api/v1/student/sessions/${session.joinCode}`);
      if ((publicSnapshot.myQuestions || []).length ||
          (publicSnapshot.questionAnswers || []).some(answer => answer.answerVisibility === 'AUTHOR')) result.privacyErrors++;
      if (sessions.length > 1) {
        const token = joined.find(client => client.session.id === session.id)?.token;
        const other = sessions[(index + 1) % sessions.length];
        try {
          await request('GET', `/api/v1/student/sessions/${other.joinCode}`, { headers: { 'X-Participant-Token': token } });
          result.privacyErrors++;
        } catch (error) {
          if (error instanceof HttpFailure && [401, 403].includes(error.status)) result.scopeDenials.received++;
          else throw error;
        }
      }
    });
    const polls = new Map();
    await pool(sessions, 8, async session => {
      const poll = await request('POST', `/api/v1/courses/${course.id}/sessions/${session.id}/polls`, {
        token: session.teacher.accessToken, key: intent(), body: { questionText: 'Capacity first vote', options: ['First', 'Second'] } });
      polls.set(session.id, poll.poll.id);
    });
    await pool(joined, ioConcurrency, async client => {
      const path = `/api/v1/student/sessions/${client.session.joinCode}/polls/${polls.get(client.session.id)}/respond`;
      // These two endpoints have first-vote / same-value semantics independently of create keys.
      const options = { idempotent: true, headers: { 'X-Participant-Token': client.token }, body: { participantToken: client.token, optionIdx: 0 } };
      try {
        const vote = await request('POST', path, options);
        if (vote.myVote === 0) result.votes.accepted++;
        const duplicate = await request('POST', path, { ...options, body: { participantToken: client.token, optionIdx: 1 } });
        if (!duplicate.accepted && duplicate.myVote === 0) result.votes.duplicateRejected++;
        const signal = { idempotent: true, headers: { 'X-Participant-Token': client.token }, body: { participantToken: client.token, value: 'GREEN' } };
        await request('POST', `/api/v1/student/sessions/${client.session.joinCode}/signals`, signal);
        await request('POST', `/api/v1/student/sessions/${client.session.joinCode}/signals`, signal);
      } catch (error) { issue('vote-or-signal', error); }
    });
    await pool(sessions, 8, async session => {
      const resultPoll = await request('POST', `/api/v1/courses/${course.id}/sessions/${session.id}/polls/${polls.get(session.id)}/close`, { token: session.teacher.accessToken, body: {} });
      result.votes.closedTotal += resultPoll.totalResponses;
      const engagement = await request('GET', `/api/v1/courses/${course.id}/sessions/${session.id}/engagement`, { token: session.teacher.accessToken });
      if (engagement.signalAggregate?.total === configuration.students || engagement.signals?.total === configuration.students) result.feedbackVerified++;
    });
    joined.forEach(client => client.controller?.abort());
    await Promise.all(joined.map(client => client.reader));
    for (let round = 0; round < 3; round++) {
      const roundStarted = performance.now();
      await pool(joined, ioConcurrency, async client => {
        client.inflight++; result.fallback.maximumPerClientInflight = Math.max(result.fallback.maximumPerClientInflight, client.inflight);
        try {
          const snapshot = await request('GET', `/api/v1/student/sessions/${client.session.joinCode}`, { headers: { 'X-Participant-Token': client.token } });
          inspect(client, snapshot); result.fallback.received++;
        } catch (error) { issue('fallback', error); } finally { client.inflight--; }
      });
      await sleep(Math.max(0, 3000 - (performance.now() - roundStarted)));
    }
    await pool(joined, openConcurrency, open);
    await waitUntil(() => joined.every(client => client.generationSeen === 2));
    result.reconnected = joined.filter(client => client.generationSeen === 2).length;
    await imageQueue.drain();
    result.images.p95Ms = percentile(imageMs, .95);
    result.images.maximumInflight = imageQueue.maximum;
    result.passed = ratio(result.joined, expected) >= .99 && ratio(result.sseInitial, expected) >= .99 &&
      ratio(result.reconnected, expected) >= .99 && ratio(result.images.received, result.images.expected) >= .99 &&
      ratio(result.fallback.received, result.fallback.expected) >= .99 && result.privacyErrors === 0 &&
      result.votes.accepted === expected && result.votes.duplicateRejected === expected && result.votes.closedTotal === expected &&
      result.feedbackVerified === configuration.lectures && result.fallback.maximumPerClientInflight === 1 &&
      result.streamErrors === 0 && result.scopeDenials.received === result.scopeDenials.expected &&
      result.images.p95Ms < pngBudget &&
      result.delivery.every(item => ratio(item.received, item.expected) >= .99 && item.p95Ms < deliveryBudget);
  } catch (error) { issue('stage', error); }
  finally {
    clients.forEach(client => client.controller?.abort());
    await Promise.allSettled(clients.map(client => client.reader));
    await pool(sessions.filter(Boolean), 8, async session => {
      try { await request('POST', `/api/v1/courses/${course.id}/sessions/${session.id}/end`, { token: session.teacher.accessToken }); }
      catch (error) { issue('cleanup-end-session', error); result.passed = false; }
    });
    await imageQueue.drain();
  }
  result.durationMs = Math.round(performance.now() - started);
  return result;
}
await mkdir(output, { recursive: true });
try {
  await setup(Math.max(...plan.map(item => item.lectures)));
  for (const configuration of plan) {
    const result = await stage(configuration); summary.stages.push(result);
    log({ stage: `${configuration.lectures}x${configuration.students}`, passed: result.passed,
      expected: result.expectedClients, joined: result.joined, sse: result.sseInitial, reconnect: result.reconnected });
    await writeFile(resolve(output, 'summary.json'), JSON.stringify({ ...summary, http: stats }, null, 2));
    if (!result.passed && process.env.CAPACITY_CONTINUE !== 'true') break;
  }
  summary.passed = summary.stages.length === plan.length && summary.stages.every(item => item.passed);
} catch (error) { summary.setupFailure = error instanceof HttpFailure ? `HTTP ${error.status}` : error.message; }
finally {
  clearInterval(progress); summary.finishedAt = new Date().toISOString(); summary.http = stats;
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
}
log({ finished: true, passed: summary.passed, completedStages: summary.stages.length, expectedStages: plan.length });
process.exitCode = summary.passed ? 0 : 1;
