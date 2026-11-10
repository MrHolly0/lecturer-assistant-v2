// Functional KEDA/HPA proof on a private k3d lab; never targets the live installation.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { boundedHttpClient } from './http-client.mjs';
const exec = promisify(execFile), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const kubeconfig = process.env.SCALE_KUBECONFIG ?? '/private/tmp/lecturer-autoscale.kubeconfig';
if (process.env.SCALE_LAB !== 'true' || kubeconfig !== '/private/tmp/lecturer-autoscale.kubeconfig')
  throw new Error('Explicit isolated autoscaling lab required');
const ns = 'lecturer-autoscale', apiBase = 'http://127.0.0.1:18089', streamBase = 'http://127.0.0.1:18091';
const http = boundedHttpClient(apiBase, 16), clients = [], results = { checks: [], phases: [] };
const reportFile = `artifacts/autoscaling-${Date.now()}.json`;
const fixture = JSON.parse(await readFile('/private/tmp/lecturer-scale-fixture.json'));
let token, root, session;
async function kube(...args) {
  return (await exec('kubectl', ['--kubeconfig', kubeconfig, '-n', ns, ...args], { timeout: 15000 })).stdout;
}
async function prom(query) {
  const path = `/api/v1/namespaces/${ns}/services/prometheus:9090/proxy/api/v1/query?query=${encodeURIComponent(query)}`;
  const response = JSON.parse(await kube('get', '--raw', path));
  assert.equal(response.status, 'success'); return response.data.result;
}
async function api(method, path, body, auth = token) {
  const response = await http.fetch('/api/v1' + path, { method, signal: AbortSignal.timeout(15000),
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status} ${method} ${path}`); }
  return response.status === 204 ? null : response.json();
}
async function until(label, check, timeout = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) { console.log(JSON.stringify({ phase: label, ms: Date.now() - start })); return; }
    await sleep(1500);
  }
  throw new Error('Deadline: ' + label);
}
async function state() {
  const dep = JSON.parse(await kube('get', 'deployment', 'realtime', '-o', 'json'));
  const counts = await prom('realtime_connections{job="realtime",namespace="lecturer-autoscale"}');
  return { desired: dep.spec.replicas, ready: dep.status.readyReplicas ?? 0,
    pods: Object.fromEntries(counts.map(row => [row.metric.pod, Number(row.value[1])])) };
}
function connect(participant) {
  const client = { participant, controller: new AbortController(), snapshots: [], connects: 0,
    disconnects: [], active: true, errors: 0, violation: null };
  client.task = (async () => {
    while (client.active) {
      try {
        const response = await fetch(`${streamBase}/api/v1/student/sessions/${session.joinCode}/events?`
          + new URLSearchParams({ participantToken: participant.participantToken }), { signal: client.controller.signal });
        if (response.status !== 200) { await response.body?.cancel(); throw new Error('Retry stream'); }
        client.connects++;
        let buffer = '';
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (frame.startsWith('event: snapshot')) {
              const snapshot = JSON.parse(frame.split('\ndata: ')[1]);
              if (snapshot.sessionId !== session.id) {
                client.violation = 'Wrong lecture snapshot'; stop(client); break;
              }
              client.snapshots.push(snapshot);
              if (client.snapshots.length > 30) client.snapshots.shift();
            }
          }
        }
      } catch { if (client.active) client.errors++; }
      if (client.active) { client.disconnects.push(Date.now()); await sleep(250 + Math.random() * 750); }
    }
  })();
  clients.push(client); return client;
}
function stop(client) { client.active = false; client.controller.abort(); }
async function wave(count) {
  const wave = [];
  for (let i = 0; i < count; i++) {
    const participant = await api('POST', `/student/sessions/${session.joinCode}/join`,
      { displayName: `Autoscale ${clients.length}` }, null);
    wave.push(connect(participant));
    // Keep admission below the deliberately bounded initial-grant concurrency.
    if (i % 8 === 7) await sleep(120);
  }
  await until('wave-connected-' + clients.length, () => wave.every(c => c.snapshots.length));
}
async function delivery(live, label) {
  const changed = await api('POST', root + '/pause');
  await until(label, () => live.every(c => c.snapshots.some(s => s.version >= changed.version)), 30000);
  await api('POST', root + '/resume');
}
try {
  token = (await api('POST', '/auth/login', { email: fixture.email, password: fixture.password }, null)).accessToken;
  const lecture = await api('POST', `/courses/${fixture.course.id}/lectures`,
    { title: 'Autoscaling ' + randomUUID(), deckId: fixture.deck.id });
  session = await api('POST', `/courses/${fixture.course.id}/lectures/${lecture.id}/sessions`,
    { groups: [{ groupName: 'Autoscaling lab' }] });
  root = `/courses/${fixture.course.id}/sessions/${session.id}`;
  await api('POST', root + '/begin');
  await until('baseline-two-ready', async () => { const s = await state(); return s.desired === 2 && s.ready === 2; });
  // 65/3 is within HPA's 10% tolerance around 20; use a wave that exceeds that band.
  await wave(80);
  await until('controller-scaled-four', async () => { const s = await state(); return s.desired === 4 && s.ready === 4; });
  await wave(40);
  await until('all-four-receive-connections', async () => {
    const s = await state(); return Object.values(s.pods).filter(n => n > 0).length === 4;
  });
  results.phases.push({ phase: 'up', ...await state(), students: clients.length });
  await delivery(clients, 'delivery-after-growth');
  const question = await api('POST', `/student/sessions/${session.joinCode}/questions`,
    { participantToken: clients[0].participant.participantToken, text: 'Private autoscale ' + randomUUID(), anonymous: true }, null);
  const answer = 'private-' + randomUUID();
  await api('PUT', root + '/questions/' + question.id, { status: 'ANSWERED', answerText: answer, answerVisibility: 'AUTHOR' });
  await until('private-answer-author', () => clients[0].snapshots.some(s => JSON.stringify(s.questionAnswers).includes(answer)), 15000);
  assert.ok(clients.slice(1).every(c => c.snapshots.every(s => !JSON.stringify(s).includes(answer))));
  results.checks.push('private-answer-isolated-after-scale-up');
  // Keep enough live readers that downscaled pods demonstrably contain connections.
  const retained = clients.filter((_, index) => index % 4 === 0);
  clients.filter(c => !retained.includes(c)).forEach(stop);
  await until('thirty-retained', async () => Object.values((await state()).pods).reduce((a, b) => a + b, 0) === 30);
  const before = await state();
  const reconnectBefore = retained.reduce((sum, c) => sum + c.disconnects.length, 0);
  await until('controller-returned-two', async () => {
    const s = await state(); return s.desired === 2 && s.ready === 2 && Object.keys(s.pods).length === 2;
  }, 300000);
  await until('retained-reconnected', () => retained.every(c => c.connects && c.active), 10000);
  await delivery(retained, 'delivery-after-shrink');
  const reconnects = retained.reduce((sum, c) => sum + c.disconnects.length, 0) - reconnectBefore;
  assert.ok(reconnects > 0, 'Downscaling must migrate actual active connections');
  results.phases.push({ phase: 'down', before, ...await state(), retained: retained.length, reconnects });
  const participants = await api('GET', root + '/participants');
  // SSE reconnect must not create another participant record.
  assert.equal(participants.length, 120);
  results.checks.push('downscale-reconnects-preserve-participants-and-delivery');
  // A missing telemetry server must use the bounded fallback, never appear as zero demand.
  await kube('scale', 'deployment/prometheus', '--replicas=0');
  try {
    await until('telemetry-fallback-four', async () => {
      const obj = JSON.parse(await kube('get', 'scaledobject', 'realtime', '-o', 'json'));
      const dep = JSON.parse(await kube('get', 'deployment', 'realtime', '-o', 'json'));
      return obj.status.conditions?.some(c => c.type === 'Fallback' && c.status === 'True') && dep.spec.replicas === 4;
    }, 180000);
    await delivery(retained, 'delivery-without-telemetry');
    results.checks.push('telemetry-failure-bounded-fallback');
  } finally { await kube('scale', 'deployment/prometheus', '--replicas=1'); }
  assert.ok(clients.every(c => !c.violation));
  results.passed = true;
} finally {
  clients.forEach(stop); await Promise.allSettled(clients.map(c => c.task));
  if (root) { try { await api('POST', root + '/end'); results.sessionEnded = true; } catch { results.sessionEnded = false; } }
  http.close();
  results.at = new Date().toISOString();
  await writeFile(reportFile, JSON.stringify(results, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(results));
}
