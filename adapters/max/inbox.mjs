import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export class DurableInbox {
  constructor(path, { now = Date.now, maxItems = 20000, maxBytes = 64 * 1024 * 1024,
    maxCompleted = 250000, maxDeadItems = 1000, maxDeadBytes = 8 * 1024 * 1024 } = {}) {
    for (const limit of [maxItems, maxBytes, maxCompleted, maxDeadItems, maxDeadBytes])
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid inbox budget');
    mkdirSync(dirname(path), { recursive: true });
    Object.assign(this, { now, maxItems, maxBytes, maxCompleted, maxDeadItems, maxDeadBytes });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
      PRAGMA max_page_count=65536; PRAGMA journal_size_limit=67108864;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS inbox_due ON inbox(state,due);
      CREATE INDEX IF NOT EXISTS inbox_age ON inbox(state,created);
      CREATE TABLE IF NOT EXISTS completed(id TEXT PRIMARY KEY, finished INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS completed_age ON completed(finished);
      CREATE TABLE IF NOT EXISTS inbox_budget(id INTEGER PRIMARY KEY CHECK(id=1),
        work_items INTEGER NOT NULL,work_bytes INTEGER NOT NULL,dead_items INTEGER NOT NULL,
        dead_bytes INTEGER NOT NULL,dedup_items INTEGER NOT NULL,dedup_evictions INTEGER NOT NULL DEFAULT 0,dead_blocked INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO completed SELECT id,due FROM inbox WHERE state='DONE';
      DELETE FROM inbox WHERE state='DONE';`);
    if (!this.db.prepare('SELECT 1 FROM inbox_budget WHERE id=1').get()) this.db.exec(`
      INSERT INTO inbox_budget(id,work_items,work_bytes,dead_items,dead_bytes,dedup_items)
      SELECT 1,coalesce(sum(state IN ('PENDING','RUNNING')),0),
        coalesce(sum(CASE WHEN state IN ('PENDING','RUNNING') THEN length(cast(payload AS blob)) ELSE 0 END),0),
        coalesce(sum(state='DEAD'),0),coalesce(sum(CASE WHEN state='DEAD' THEN length(cast(payload AS blob)) ELSE 0 END),0),
        (SELECT count(*) FROM completed) FROM inbox;`);
    const amount = (row, state, bytes) => `CASE WHEN ${row}.state ${state} THEN ${bytes ? `length(cast(${row}.payload AS blob))` : '1'} ELSE 0 END`;
    for (const [action, parts] of [['INSERT', [['NEW', '+']]], ['DELETE', [['OLD', '-']]], ['UPDATE', [['OLD', '-'], ['NEW', '+']]]]) {
      const fields = [['work_items', "IN ('PENDING','RUNNING')", false], ['work_bytes', "IN ('PENDING','RUNNING')", true],
        ['dead_items', "='DEAD'", false], ['dead_bytes', "='DEAD'", true]];
      this.db.exec(`CREATE TRIGGER IF NOT EXISTS inbox_budget_${action} AFTER ${action} ON inbox BEGIN UPDATE inbox_budget SET ` +
        fields.map(([field, state, bytes]) => `${field}=${field}` + parts.map(([row, sign]) => sign + '(' + amount(row, state, bytes) + ')').join('')).join(',') + ' WHERE id=1; END;');
    }
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS completed_add AFTER INSERT ON completed BEGIN UPDATE inbox_budget SET dedup_items=dedup_items+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS completed_remove AFTER DELETE ON completed BEGIN UPDATE inbox_budget SET dedup_items=dedup_items-1 WHERE id=1; END;
      COMMIT;`);
    this.retain();
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  capacity() { return this.db.prepare('SELECT * FROM inbox_budget WHERE id=1').get(); }
  deadFull(used = this.capacity()) { return Boolean(used.dead_blocked) || used.dead_items >= this.maxDeadItems || used.dead_bytes >= this.maxDeadBytes; }
  roomFor(bytes, used = this.capacity()) {
    if (bytes > this.maxDeadBytes || used.work_items >= this.maxItems || used.work_bytes + bytes > this.maxBytes || this.deadFull(used))
      throw Object.assign(new Error('Webhook work queue full'), { status: 503 });
  }
  enqueue(update) {
    let payload;
    try { payload = JSON.stringify(canonical(update)); }
    catch { throw Object.assign(new Error('Invalid webhook structure'), { status: 400 }); }
    const bytes = Buffer.byteLength(payload);
    if (bytes > 65536) throw Object.assign(new Error('Webhook body too large'), { status: 413 });
    const id = createHash('sha256').update(payload).digest('hex');
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM inbox WHERE id=?').get(id) ||
          this.db.prepare('SELECT 1 FROM completed WHERE id=? AND finished>?').get(id, this.now() - 7 * 86400000)) return id;
      this.roomFor(bytes);
      this.db.prepare('DELETE FROM completed WHERE id=?').run(id);
      this.db.prepare("INSERT INTO inbox(id,payload,state,due,created) VALUES(?,?,'PENDING',?,?)").run(id, payload, this.now(), this.now());
      return id;
    });
  }
  claim() {
    return this.transaction(() => {
      if (this.deadFull()) return undefined;
      const row = this.db.prepare("SELECT * FROM inbox WHERE state IN ('PENDING','RUNNING') AND due<=? ORDER BY due LIMIT 1").get(this.now());
      if (row) this.db.prepare("UPDATE inbox SET state='RUNNING',attempts=attempts+1,due=? WHERE id=?").run(this.now() + 120000, row.id);
      return row && { ...row, attempts: row.attempts + 1, update: JSON.parse(row.payload) };
    });
  }
  current(job) { return this.db.prepare("SELECT * FROM inbox WHERE id=? AND state='RUNNING' AND attempts=?").get(job.id, job.attempts); }
  finish(job) {
    return this.transaction(() => {
      if (!this.current(job)) return false;
      this.db.prepare('INSERT INTO completed(id,finished) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET finished=excluded.finished').run(job.id, this.now());
      this.db.prepare('DELETE FROM inbox WHERE id=?').run(job.id);
      this.pruneCompleted();
      return true;
    });
  }
  retry(job) {
    return this.transaction(() => {
      const row = this.current(job); if (!row) return false;
      const used = this.capacity(), bytes = Buffer.byteLength(row.payload);
      const dead = job.attempts >= 8 && used.dead_items < this.maxDeadItems && used.dead_bytes + bytes <= this.maxDeadBytes;
      if (job.attempts >= 8 && !dead) this.db.prepare('UPDATE inbox_budget SET dead_blocked=1 WHERE id=1').run();
      this.db.prepare('UPDATE inbox SET state=?,due=? WHERE id=?').run(dead ? 'DEAD' : 'PENDING',
        this.now() + 1000 + Math.floor(Math.random() * Math.min(300000, 1000 * 2 ** Math.min(job.attempts, 12))), job.id);
      return true;
    });
  }
  pruneCompleted() {
    const excess = Math.max(0, this.capacity().dedup_items - this.maxCompleted);
    if (excess) {
      const removed = this.db.prepare('DELETE FROM completed WHERE id IN (SELECT id FROM completed ORDER BY finished,rowid LIMIT ?)').run(excess).changes;
      this.db.prepare('UPDATE inbox_budget SET dedup_evictions=dedup_evictions+? WHERE id=1').run(removed);
    }
  }
  retain() {
    this.transaction(() => {
      this.db.prepare('DELETE FROM completed WHERE id IN (SELECT id FROM completed WHERE finished<=? ORDER BY finished LIMIT 1000)').run(this.now() - 7 * 86400000);
      this.pruneCompleted();
    });
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  }
  stats() {
    const rows = this.db.prepare('SELECT state,count(*) AS count,min(created) AS oldest FROM inbox GROUP BY state').all();
    const count = this.capacity().dedup_items;
    if (count) rows.push({ state: 'DONE', count, oldest: this.db.prepare('SELECT finished FROM completed ORDER BY finished LIMIT 1').get().finished });
    return rows.sort((a, b) => a.state.localeCompare(b.state));
  }
  dead(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be 1..100');
    return this.db.prepare("SELECT id,attempts,created,due,length(cast(payload AS blob)) AS bytes FROM inbox WHERE state='DEAD' ORDER BY created LIMIT ?").all(limit);
  }
  inspectDead(id) { const row = this.db.prepare("SELECT payload FROM inbox WHERE id=? AND state='DEAD'").get(id); return row && JSON.parse(row.payload); }
  retryDead(id) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT payload FROM inbox WHERE id=? AND state='DEAD'").get(id);
      if (!row) return false;
      const used = this.capacity();
      if (used.work_items >= this.maxItems || used.work_bytes + Buffer.byteLength(row.payload) > this.maxBytes)
        throw Object.assign(new Error('Webhook work queue full'), { status: 503 });
      this.db.prepare('UPDATE inbox_budget SET dead_blocked=0 WHERE id=1').run();
      return this.db.prepare("UPDATE inbox SET state='PENDING',attempts=0,due=? WHERE id=? AND state='DEAD'").run(this.now(), id).changes === 1;
    });
  }
  purgeDead(id) {
    return this.transaction(() => {
      const changed = this.db.prepare("DELETE FROM inbox WHERE id=? AND state='DEAD'").run(id).changes === 1;
      if (changed) this.db.prepare('UPDATE inbox_budget SET dead_blocked=0 WHERE id=1').run();
      return changed;
    });
  }
  close() { this.db.close(); }
}

export function webhookHandler({ inbox, path, secret, equals }) {
  let active = 0;
  return async (request, response) => {
    if (request.method !== 'POST' || request.url !== path || !equals(String(request.headers['x-max-bot-api-secret'] ?? ''), secret)) {
      response.writeHead(404).end(); return;
    }
    if (active >= 32) { response.writeHead(503, { 'Retry-After': '3' }).end(); return; }
    active++;
    const timer = setTimeout(() => request.destroy(), 5000);
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 65536) { response.writeHead(413, { Connection: 'close' }).end(); return; }
        chunks.push(chunk);
      }
      let update;
      try { update = JSON.parse(Buffer.concat(chunks)); if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error(); }
      catch { response.writeHead(400).end(); return; }
      inbox.enqueue(update); // FULL synchronous SQLite commit precedes acknowledgement.
      response.writeHead(200).end();
    } catch (error) {
      if (!response.headersSent && !response.destroyed) response.writeHead(error.status ?? 503, { 'Retry-After': '3' }).end();
    } finally { clearTimeout(timer); active--; }
  };
}
