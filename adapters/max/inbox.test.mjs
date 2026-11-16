import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DurableInbox, webhookHandler } from './inbox.mjs';

test('committed updates survive a process restart; duplicate field order does not enqueue twice', () => {
  const root=mkdtempSync(join(tmpdir(),'max-inbox-'));let now=1000;
  try {
    let inbox=new DurableInbox(join(root,'db'),{now:()=>now,maxItems:2});
    const id=inbox.enqueue({update_type:'message_created',message:{id:1,text:'hello'}});
    assert.equal(id,inbox.enqueue({message:{text:'hello',id:1},update_type:'message_created'}));
    const job=inbox.claim();assert.equal(job.id,id);inbox.close();
    inbox=new DurableInbox(join(root,'db'),{now:()=>now,maxItems:2});
    assert.equal(inbox.claim(),undefined);
    now+=120001;const recovered=inbox.claim();assert.equal(recovered.id,id);assert.equal(recovered.attempts,2);
    inbox.finish(recovered);assert.equal(inbox.claim(),undefined);inbox.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('full inbox rejects new events but acknowledges already durable duplicates; retries end in dead-letter', () => {
  const root=mkdtempSync(join(tmpdir(),'max-inbox-'));let now=0;
  try {
    const inbox=new DurableInbox(join(root,'db'),{now:()=>now,maxItems:1});
    inbox.enqueue({id:1});assert.throws(()=>inbox.enqueue({id:2}),e=>e.status===503);inbox.enqueue({id:1});
    for(let i=0;i<8;i++){const job=inbox.claim();assert.ok(job);inbox.retry(job);now+=400000;}
    assert.equal(inbox.claim(),undefined);assert.equal(inbox.stats()[0].state,'DEAD');inbox.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('webhook returns success only after a durable commit, with bounded body and backpressure', async () => {
  const root=mkdtempSync(join(tmpdir(),'max-inbox-'));
  const inbox=new DurableInbox(join(root,'db'),{maxItems:1});
  const server=createServer(webhookHandler({inbox,path:'/hook',secret:'test',equals:(a,b)=>a===b}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/hook`;
  try {
    const send=body=>fetch(url,{method:'POST',headers:{'x-max-bot-api-secret':'test'},body});
    assert.equal((await send('{"id":1}')).status,200);
    const reader=new DurableInbox(join(root,'db'));assert.equal(reader.stats()[0].count,1);reader.close();
    assert.equal((await send('{"id":2}')).status,503);
    assert.equal((await send('{"id":1}')).status,200);
    assert.equal((await send('x'.repeat(65537))).status,413);
    assert.equal((await send('{bad')).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));inbox.close();rmSync(root,{recursive:true,force:true});}
});

test('online inbox backup includes committed WAL pages and can resume pending work',async()=>{
  const { execFileSync }=await import('node:child_process');
  const {writeFileSync}=await import('node:fs');
  const root=mkdtempSync(join(tmpdir(),'max-snapshot-'));
  const inbox=new DurableInbox(join(root,'db'));
  try {
    inbox.enqueue({update_type:'message_created',message:{id:'committed-before-backup'}});
    const bytes=execFileSync(process.execPath,[new URL('./inbox-snapshot.mjs',import.meta.url).pathname],{
      env:{...process.env,MAX_INBOX_PATH:join(root,'db')},maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']
    });
    writeFileSync(join(root,'restored'),bytes);
    const restored=new DurableInbox(join(root,'restored'));
    assert.equal(restored.claim().update.message.id,'committed-before-backup');restored.close();
  }finally{inbox.close();rmSync(root,{recursive:true,force:true});}
});

test('more than twenty thousand completed updates preserve admission and retained deduplication', { timeout: 60000 }, () => {
  const inbox = new DurableInbox(':memory:');
  try {
    for (let i = 0; i < 20010; i++) {
      inbox.enqueue({ sequence: i }); assert.equal(inbox.finish(inbox.claim()), true);
    }
    assert.equal(inbox.capacity().work_items, 0);
    assert.equal(inbox.capacity().dedup_items, 20010);
    inbox.enqueue({ sequence: 20009 }); assert.equal(inbox.claim(), undefined);
    inbox.enqueue({ sequence: 20010 }); assert.ok(inbox.claim());
  } finally { inbox.close(); }
});

test('work bytes, completed retention, and dead letters have independent bounded budgets', () => {
  let now = 100000;
  const inbox = new DurableInbox(':memory:', { now: () => now, maxItems: 2, maxBytes: 100, maxCompleted: 3, maxDeadItems: 1 });
  try {
    for (let i = 0; i < 6; i++) { inbox.enqueue({ i }); inbox.finish(inbox.claim()); now++; }
    assert.equal(inbox.capacity().dedup_items, 3); assert.equal(inbox.capacity().dedup_evictions, 3);
    inbox.enqueue({ i: 5 }); assert.equal(inbox.claim(), undefined);
    inbox.enqueue({ i: 0 }); assert.ok(inbox.claim(), 'outside the documented retained window an event may replay');
    assert.throws(() => inbox.enqueue({ large: 'x'.repeat(100) }), e => e.status === 503);
    const active = inbox.db.prepare("SELECT * FROM inbox WHERE state='RUNNING'").get();
    now += 120001;
    let job = inbox.claim();
    assert.equal(inbox.finish({ ...job, attempts: job.attempts - 1 }), false);
    assert.equal(inbox.retry({ ...job, attempts: job.attempts - 1 }), false);
    while (job.attempts < 8) { inbox.retry(job); now += 301000; job = inbox.claim(); }
    inbox.retry(job);
    assert.equal(inbox.dead()[0].id, active.id);
    assert.equal(inbox.capacity().work_items, 0);
    assert.equal(inbox.capacity().dead_items, 1);
    assert.throws(() => inbox.enqueue({ newWork: true }), e => e.status === 503);
    assert.equal(inbox.retryDead(job.id), true);
    assert.equal(inbox.capacity().dead_items, 0);
    const retried = inbox.claim(); assert.equal(retried.attempts, 1); inbox.finish(retried);
    assert.equal(inbox.capacity().work_bytes, 0);
    assert.equal(inbox.capacity().dead_bytes, 0);
    assert.equal(inbox.purgeDead(job.id), false);
  } finally { inbox.close(); }
});

test('old DONE rows migrate into completed dedup without consuming work slots', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { createHash } = await import('node:crypto');
  const root = mkdtempSync(join(tmpdir(), 'max-inbox-upgrade-'));
  const payload = JSON.stringify({ sequence: 1 });
  const id = createHash('sha256').update(payload).digest('hex');
  try {
    const old = new DatabaseSync(join(root, 'db'));
    old.exec('CREATE TABLE inbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL,created INTEGER NOT NULL)');
    old.prepare("INSERT INTO inbox VALUES(?,?,'DONE',1,100000,100000)").run(id, payload); old.close();
    const inbox = new DurableInbox(join(root, 'db'), { now: () => 100000, maxItems: 1 });
    try {
      inbox.enqueue({ sequence: 1 }); assert.equal(inbox.claim(), undefined);
      inbox.enqueue({ sequence: 2 }); assert.ok(inbox.claim());
      assert.equal(inbox.capacity().dedup_items, 1); assert.equal(inbox.capacity().work_items, 1);
    } finally { inbox.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('local dead-letter commands list metadata, retry and purge without losing counters', async () => {
  const { execFileSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'max-inbox-ops-'));
  const path = join(root, 'db');
  let now = Date.now();
  const inbox = new DurableInbox(path, { now: () => now });
  let id;
  try {
    inbox.enqueue({ privateStudentField: 'fixture-private' });
    let job = inbox.claim(); id = job.id;
    while (job.attempts < 8) { inbox.retry(job); now += 301000; job = inbox.claim(); }
    inbox.retry(job);
  } finally { inbox.close(); }
  const command = (...args) => execFileSync(process.execPath,
    [new URL('./inbox-admin.mjs', import.meta.url).pathname, ...args],
    { env: { ...process.env, MAX_INBOX_PATH: path }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const metadata = command('list');
    assert.equal(JSON.parse(metadata)[0].id, id);
    assert.equal(metadata.includes('fixture-private'), false);
    assert.ok(command('metrics').includes('lecturer_max_inbox_dead_items 1'));
    assert.equal(command('metrics').includes('fixture-private'), false);
    assert.equal(JSON.parse(command('show', id)).privateStudentField, 'fixture-private');
    assert.equal(JSON.parse(command('retry', id)).changed, true);
    assert.equal(JSON.parse(command('stats')).dead_items, 0);
    assert.equal(JSON.parse(command('stats')).work_items, 1);
    const reopened = new DurableInbox(path, { now: () => now });
    try {
      let job = reopened.claim();
      while (job.attempts < 8) { reopened.retry(job); now += 301000; job = reopened.claim(); }
      reopened.retry(job);
    } finally { reopened.close(); }
    assert.equal(JSON.parse(command('purge', id)).changed, true);
    assert.equal(JSON.parse(command('purge', id)).changed, false);
    assert.equal(JSON.parse(command('stats')).work_bytes, 0);
    assert.equal(JSON.parse(command('stats')).dead_bytes, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
