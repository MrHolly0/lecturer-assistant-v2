import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { AnalyticsStore } from '../analytics/store.mjs';

test('real PostgreSQL inbox, fencing and versioned read model', {
  skip: !process.env.SERVICES_TEST_DATABASE_URL
}, async t => {
  const pool = new pg.Pool({ connectionString: process.env.SERVICES_TEST_DATABASE_URL, max: 4 });
  t.after(() => pool.end());
  await pool.query(await readFile(new URL('../analytics/schema.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE inbox, reports, report_jobs, rejected_events');
  const store = new AnalyticsStore(pool), session = randomUUID();
  const event = Buffer.from(JSON.stringify({ eventId: randomUUID(), schemaVersion: 1,
    type: 'session.ended', sessionId: session, audience: 'INTERNAL', occurredAt: new Date().toISOString(),
    aggregate: { type: 'session', id: session, revision: 1 }, data: {} }));
  assert.equal(await store.receive(event), true);
  assert.equal(await store.receive(event), false);
  const first = await store.claim();
  assert.equal(await store.claim(), undefined);
  await pool.query("UPDATE report_jobs SET lease_until = now() - interval '1 second'");
  const second = await store.claim();
  const exported = { sessionId: session, fingerprint: 'a'.repeat(64), summary: { participantCount: 3 } };
  assert.equal(await store.finish(first, exported), false);
  await store.enqueue(session); // New receipt arrived while worker was building.
  assert.equal(await store.finish(second, exported), false);
  assert.equal((await pool.query('SELECT * FROM reports')).rowCount, 0);
  const third = await store.claim();
  assert.equal(await store.finish(third, exported), true);
  assert.deepEqual(await store.read(session, 'a'.repeat(64)), { participantCount: 3 });
  assert.equal(await store.read(session, 'b'.repeat(64)), null);
  const queued = await store.claim();
  await store.read(session, 'b'.repeat(64));
  assert.equal((await pool.query('SELECT generation FROM report_jobs')).rows[0].generation, queued.generation);
  await store.retry(queued);
  assert.equal(await store.claim(), undefined);
  assert.equal(await store.receive(Buffer.from('{"private":"MUST_NOT_STORE"}')), false);
  const rejected = JSON.stringify((await pool.query('SELECT * FROM rejected_events')).rows);
  assert.doesNotMatch(rejected, /MUST_NOT_STORE/);
});
