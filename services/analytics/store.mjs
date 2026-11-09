import { randomUUID, createHash } from 'node:crypto';
import { integrationEvent } from '../common/contracts.mjs';

export class AnalyticsStore {
  constructor(pool) { this.pool = pool; }
  async transaction(action) {
    const db = await this.pool.connect();
    try { await db.query('BEGIN'); const result = await action(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }

  async receive(bytes) {
    let event;
    try { event = JSON.parse(bytes); } catch { /* Quarantine only a digest, never private event contents. */ }
    if (bytes.length > 65536 || !integrationEvent(event)) {
      await this.pool.query(`INSERT INTO rejected_events(digest, reason)
        SELECT $1, 'Invalid envelope' WHERE (SELECT count(*) FROM rejected_events) < 10000
        ON CONFLICT DO NOTHING`, [createHash('sha256').update(bytes).digest('hex')]);
      return false;
    }
    return this.transaction(async db => {
      const inserted = await db.query('INSERT INTO inbox(event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id',
        [event.eventId]);
      if (!inserted.rowCount) return false;
      if (event.sessionId && event.type !== 'summary.opened') await this.enqueue(event.sessionId, db);
      return true;
    });
  }

  async enqueue(session, db = this.pool) {
    await db.query(`INSERT INTO report_jobs(session_id) VALUES ($1)
      ON CONFLICT (session_id) DO UPDATE SET generation = report_jobs.generation + 1,
        next_attempt_at = now(), attempts = 0, dead = false`, [session]);
  }

  async read(session, fingerprint) {
    const report = await this.pool.query('SELECT payload FROM reports WHERE session_id = $1 AND fingerprint = $2',
      [session, fingerprint]);
    if (report.rowCount) return report.rows[0].payload;
    // Repeated reads don't invalidate the in-flight generation or bypass its retry delay.
    await this.pool.query('INSERT INTO report_jobs(session_id) VALUES ($1) ON CONFLICT DO NOTHING', [session]);
    return null;
  }

  async claim() {
    const result = await this.pool.query(`WITH candidate AS (
      SELECT session_id FROM report_jobs WHERE NOT dead AND next_attempt_at <= now()
        AND (lease_until IS NULL OR lease_until <= now()) FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE report_jobs j SET claim_token = $1, lease_until = now() + interval '60 seconds', attempts = attempts + 1
      FROM candidate c WHERE j.session_id = c.session_id RETURNING j.*`, [randomUUID()]);
    return result.rows[0];
  }

  async finish(job, exported) {
    return this.transaction(async db => {
      const current = await db.query(`SELECT generation FROM report_jobs WHERE session_id = $1 AND claim_token = $2
        AND lease_until > now() FOR UPDATE`, [job.session_id, job.claim_token]);
      if (!current.rowCount) return false;
      if (String(current.rows[0].generation) !== String(job.generation)) {
        await db.query('UPDATE report_jobs SET claim_token = null, lease_until = null WHERE session_id = $1',
          [job.session_id]);
        return false;
      }
      if (exported) {
        if (exported.sessionId !== job.session_id || !/^[a-f0-9]{64}$/.test(exported.fingerprint))
          throw new Error('Invalid exported report');
        await db.query(`INSERT INTO reports(session_id, fingerprint, payload) VALUES ($1, $2, $3)
          ON CONFLICT (session_id) DO UPDATE SET fingerprint = excluded.fingerprint,
            payload = excluded.payload, prepared_at = now()`,
        [job.session_id, exported.fingerprint, exported.summary]);
      } else {
        await db.query('DELETE FROM reports WHERE session_id = $1', [job.session_id]);
      }
      await db.query('DELETE FROM report_jobs WHERE session_id = $1 AND claim_token = $2',
        [job.session_id, job.claim_token]);
      return true;
    });
  }

  async retry(job) {
    await this.pool.query(`UPDATE report_jobs SET claim_token = null, lease_until = null,
      dead = attempts >= 8, next_attempt_at = now() + make_interval(secs =>
        least(300.0, power(2.0, least(attempts, 8))) * (0.5 + random() / 2))
      WHERE session_id = $1 AND claim_token = $2`, [job.session_id, job.claim_token]);
  }

  async retain() {
    await this.pool.query(`DELETE FROM inbox WHERE event_id IN (SELECT event_id FROM inbox
      WHERE received_at < now() - interval '7 days' LIMIT 10000)`);
  }
}
