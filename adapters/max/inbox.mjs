import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export class DurableInbox {
  constructor(path, { now = Date.now, maxItems = 20000, maxBytes = 64 * 1024 * 1024 } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path); this.now = now; this.maxItems = maxItems; this.maxBytes = maxBytes;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
      PRAGMA max_page_count=32768;
      CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS inbox_due ON inbox(state,due);`);
  }
  enqueue(update) {
    let payload;
    try {payload=JSON.stringify(canonical(update));}
    catch {throw Object.assign(new Error("Invalid webhook structure"),{status:400});}
    if (Buffer.byteLength(payload) > 65536) throw Object.assign(new Error('Webhook body too large'), { status: 413 });
    const id = createHash('sha256').update(payload).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('SELECT 1 FROM inbox WHERE id=?').get(id)) {
        const used = this.db.prepare('SELECT count(*) AS n, coalesce(sum(length(cast(payload AS blob))),0) AS bytes FROM inbox').get();
        if (used.n >= this.maxItems || used.bytes + Buffer.byteLength(payload) > this.maxBytes)
          throw Object.assign(new Error('Webhook inbox full'), { status: 503 });
        this.db.prepare("INSERT INTO inbox(id,payload,state,due,created) VALUES(?,?,'PENDING',?,?)").run(id,payload,this.now(),this.now());
      }
      this.db.exec('COMMIT'); return id;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  claim() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare("SELECT * FROM inbox WHERE state IN ('PENDING','RUNNING') AND due<=? ORDER BY due LIMIT 1").get(this.now());
      if (row) this.db.prepare("UPDATE inbox SET state='RUNNING',attempts=attempts+1,due=? WHERE id=?").run(this.now()+120000,row.id);
      this.db.exec('COMMIT'); return row && { ...row, attempts: row.attempts+1, update: JSON.parse(row.payload) };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  finish(job) { this.db.prepare("UPDATE inbox SET state='DONE',payload='{}',due=? WHERE id=?").run(this.now(),job.id); }
  retry(job) {
    this.db.prepare('UPDATE inbox SET state=?,due=? WHERE id=?').run(job.attempts >= 8 ? 'DEAD' : 'PENDING',
      this.now()+1000+Math.floor(Math.random()*Math.min(300000,1000*2**job.attempts)),job.id);
  }
  retain() {
    this.db.prepare("DELETE FROM inbox WHERE id IN (SELECT id FROM inbox WHERE state='DONE' AND due<? LIMIT 1000)").run(this.now()-7*86400000);
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  stats() { return this.db.prepare('SELECT state,count(*) AS count,min(created) AS oldest FROM inbox GROUP BY state').all(); }
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
