#!/usr/bin/env node
// Real authority, edge, broker and gateway; freezes only the explicitly isolated lab.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket } from '../services/node_modules/ws/wrapper.mjs';

if (process.env.SCALE_LAB !== 'true') throw new Error('Requires SCALE_LAB=true');
const base = 'http://127.0.0.1:18089';
const gateways = ['a', 'b', 'c'].map(name => `lecturer-scale-lab-realtime-${name}-1`);
const authorities = ['a', 'b'].map(name => `lecturer-scale-lab-core-${name}-1`);
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
for (const name of [...gateways, ...authorities]) assert.equal(docker('inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', name).trim(), 'lecturer-scale-lab');
const fixture = JSON.parse(await readFile('/private/tmp/lecturer-scale-fixture.json', 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, ms = 10000) => {
  const deadline = performance.now() + ms;
  while (!predicate() && performance.now() < deadline) await sleep(25);
  assert.ok(predicate(), 'recovery deadline');
};
let token;
async function api(method, path, body) {
  const response = await fetch(base + '/api/v1' + path, { method, signal: AbortSignal.timeout(10000),
    headers: { ...(token && !path.startsWith('/student/') ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
token = (await api('POST', '/auth/login', { email: fixture.email, password: fixture.password })).accessToken;
const course = `/courses/${fixture.course.id}`;
const lecture = await api('POST', course + '/lectures', { title: 'Recovery fault lab ' + randomUUID(), deckId: fixture.deck.id });
const session = await api('POST', `${course}/lectures/${lecture.id}/sessions`, { groups: [{ groupName: 'Fault lab' }] });
const sessionPath = `${course}/sessions/${session.id}`;
const controllers = [], readers = [], streams = [], paused = new Set();
let ws, heartbeat, stopped = false;
const report = { passed: false, pauseMs: 8000, allowedStreamErrors: 0, presenterStreamErrors: 0,
  deniedFramesAfterPause: 0, resumedOnSameConnections: false, revokedClosed: false };
try {
  await api('POST', sessionPath + '/begin');
  for (let i = 0; i < 3; i++) {
    const joined = await api('POST', `/student/sessions/${session.joinCode}/join`, { displayName: `Fault student ${i}` });
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(base + `/api/v1/student/sessions/${session.joinCode}/events?`
      + new URLSearchParams({ participantToken: joined.participantToken }), { signal: controller.signal });
    assert.equal(response.status, 200);
    const stream = { joined, frames: [], closed: false }; streams.push(stream);
    readers.push((async () => {
      let buffer = ''; const decoder = new TextDecoder();
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            if (frame.startsWith('event: snapshot')) stream.frames.push(JSON.parse(frame.split('\ndata: ')[1]));
          }
        }
        stream.closed = true;
        if (!stopped && i !== 0) report.allowedStreamErrors++;
      } catch { stream.closed = true; if (!stopped && i !== 0) report.allowedStreamErrors++; }
    })());
  }
  const messages = [];
  ws = new WebSocket(new URL(`/ws/session/${session.id}`, base.replace('http:', 'ws:')));
  ws.on('message', bytes => {
    const text = bytes.toString();
    if (text.startsWith('CONNECTED')) ws.send(`SUBSCRIBE\nid:session\ndestination:/topic/session/${session.id}\n\n\0`);
    if (text.startsWith('MESSAGE')) messages.push(JSON.parse(text.split('\n\n')[1].replace(/\0$/, '')));
  });
  ws.on('close', () => { if (!stopped) report.presenterStreamErrors++; });
  ws.on('error', () => {});
  ws.on('open', () => ws.send(`CONNECT\nAuthorization:Bearer ${token}\n\n\0`));
  heartbeat = setInterval(() => { if (ws.readyState === 1) ws.send('\n'); }, 5000);
  await until(() => streams.every(s => s.frames.length) && messages.length);
  const banned = (await api('GET', sessionPath + '/participants')).find(p => p.displayName === 'Fault student 0');
  assert.ok(banned);
  const bannedFrames = streams[0].frames.length;
  for (const name of gateways) { docker('pause', name); paused.add(name); }
  await sleep(report.pauseMs);
  await api('POST', `${sessionPath}/participants/${banned.personId}/kick`);
  const changed = await api('PUT', sessionPath + '/slide', { slideIdx: 2 });
  const resumedAt = performance.now();
  for (const name of paused) docker('unpause', name);
  paused.clear();
  await until(() => streams[0].closed && streams.slice(1).every(s => s.frames.some(f => f.currentSlideIdx === 2))
    && messages.some(m => m.session.currentSlideIdx === 2));
  report.recoveryMs = performance.now() - resumedAt;
  report.deniedFramesAfterPause = streams[0].frames.length - bannedFrames;
  report.revokedClosed = streams[0].closed;
  report.resumedOnSameConnections = streams.slice(1).every(s => !s.closed) && ws.readyState === 1;
  assert.equal(report.deniedFramesAfterPause, 0);
  assert.equal(report.allowedStreamErrors, 0);
  assert.equal(report.presenterStreamErrors, 0);
  assert.equal(report.resumedOnSameConnections, true);
  assert.ok(changed.version);
  for (const name of authorities) { docker('pause', name); paused.add(name); }
  await sleep(8000);
  report.authorityPauseMs = 8000;
  const suspendedProbe = "fetch('http://127.0.0.1:8091/metrics').then(r=>r.text()).then(t=>console.log(t.match(/^realtime_suspended_connections (\\d+)/m)?.[1]??'0'))";
  report.authoritySuspendedConnections = gateways.reduce((sum, name) =>
    sum + Number(docker('exec', name, 'node', '-e', suspendedProbe).trim()), 0);
  assert.ok(report.authoritySuspendedConnections >= 3, 'expired grants suspend student and presenter delivery');
  const authorityResumedAt = performance.now();
  for (const name of paused) docker('unpause', name);
  paused.clear();
  await api('PUT', sessionPath + '/slide', { slideIdx: 3 });
  await until(() => streams.slice(1).every(s => s.frames.some(f => f.currentSlideIdx === 3))
    && messages.some(m => m.session.currentSlideIdx === 3));
  report.authorityRecoveryMs = performance.now() - authorityResumedAt;
  assert.equal(report.allowedStreamErrors, 0);
  assert.equal(report.presenterStreamErrors, 0);
  assert.ok(streams.slice(1).every(s => !s.closed) && ws.readyState === 1);
  report.passed = true;
} finally {
  stopped = true; clearInterval(heartbeat);
  for (const name of paused) { try { docker('unpause', name); } catch {} }
  controllers.forEach(c => c.abort()); ws?.terminate(); await Promise.allSettled(readers);
  await api('POST', sessionPath + '/end');
  await mkdir('artifacts/scalable-recovery', { recursive: true });
  await writeFile('artifacts/scalable-recovery/summary.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
