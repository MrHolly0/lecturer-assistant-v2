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
