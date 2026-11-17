import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RealtimeHub } from '../realtime/hub.mjs';
import { attachStomp } from '../realtime/stomp.mjs';
import { MediaAccess } from '../media-control/access.mjs';
import { AnalyticsStore } from '../analytics/store.mjs';
const session='11111111-1111-4111-8111-111111111111';
class Response extends EventEmitter { destroyed=false; writableLength=0;writeHead(){}flushHeaders(){}write(){return true;}end(){this.destroyed=true;this.emit('close');} }
const grant=token=>({personId:token,authVersion:1,permissionDeadline:4750,snapshot:{sessionId:session,status:'LIVE',version:1}});
test('anonymous audience cannot consume the protected connection reserve',async()=>{
 const hub=new RealtimeHub(async(path,body)=>path.endsWith('public-snapshot')?grant('').snapshot:grant(body.participantToken),{maxConnections:10,now:()=>0});
 await hub.addStudent('ABCD','',new Response(),true);
 await assert.rejects(hub.addStudent('ABCD','',new Response(),true),e=>e.status===503);
 for(let i=0;i<8;i++)await hub.addStudent('ABCD','p'+i,new Response());
 assert.equal(hub.clients.size,9);assert.equal(hub.publicCount,1);
 hub.close();assert.equal(hub.publicCount,0);assert.equal(hub.participantConnections.size,0);
});
test('tabs have a per-person cap without limiting unrelated students behind NAT',async()=>{
 const hub=new RealtimeHub(async()=>grant('same-person'),{now:()=>0});
 for(let i=0;i<3;i++)await hub.addStudent('ABCD','token'+i,new Response());
 await assert.rejects(hub.addStudent('ABCD','different-token',new Response()),e=>e.status===429);
 hub.close();
});
test('queued STOMP commands remain charged across separate messages during blocked CONNECT',async()=>{
 class Socket extends EventEmitter {readyState=1;closes=[];close(code){this.closes.push(code);}terminate(){this.readyState=3;}send(){}}
 let release;const pending=new Promise(r=>release=r);let processed=0,removed=0;
 const socket=new Socket();attachStomp(socket,session,{now:()=>0,addPresenter:()=>pending,valid:()=>{processed++;return true;},remove:c=>{if(c)removed++;}});
 socket.emit('message',Buffer.from('CONNECT\nAuthorization:Bearer test\n\n\0'));
 await new Promise(r=>setImmediate(r));
 for(let i=0;i<8;i++)socket.emit('message',Buffer.from('ACK\nx:'+'x'.repeat(30000)+'\n\n\0'));
 assert.equal(socket.closes.length,1);release({});await new Promise(r=>setImmediate(r));
 assert.equal(processed,0);assert.ok(removed>0);socket.emit('close');
});
test('an overflowing room is contained before a valid second room renews its media lease',async()=>{
 const bad='22222222-2222-4222-8222-222222222222';const person='33333333-3333-4333-8333-333333333333';const deleted=[];
 const access=new MediaAccess(async()=>({permissionDeadline:4750,rooms:[session],grants:[{id:person,room:'lecture-'+session,publisher:false}]}),
 {deleteRoom:async name=>deleted.push(name),removeParticipant:async()=>assert.fail('authorized viewer removed')},{apiKey:'test',apiSecret:'test',publicUrl:'wss://test.invalid',now:()=>0});
 const until=await access.sweep([{name:'lecture-'+bad,participants:Array(1501).fill({identity:person})},
 {name:'lecture-'+session,participants:[{identity:person,permission:{canPublish:false,canSubscribe:true}}]}]);
 assert.deepEqual(deleted,['lecture-'+bad]);assert.equal(until,4750);
});
test('live feedback does not create analytics writes or export jobs',async()=>{
 const queries=[];const pool={query:async sql=>{queries.push(sql);return {rowCount:0,rows:[]};},connect:()=>assert.fail('LIVE event opened a transaction')};
 const store=new AnalyticsStore(pool);
 await store.receive(Buffer.from(JSON.stringify({schemaVersion:1,eventId:session,type:'feedback.signal_submitted',occurredAt:new Date().toISOString(),aggregate:{type:'feedback.comprehension_signal',id:session,revision:1},sessionId:session,data:{},audience:'INTERNAL'})));
 assert.deepEqual(queries,[]);
});
test('oversized state invalidations are deduplicated until the common or personal state changes',()=>{
 const hub=new RealtimeHub(async()=>{}, {now:()=>0});const frames=[];
 const client={kind:'sse',response:{destroyed:false,writableLength:0,write:frame=>{frames.push(frame);return true;}},expiresAt:100,lastHash:''};
 hub.clients.add(client);
 const common={gatewayInvalidation:true,stateHash:'drawing-A',sessionId:session,version:1,historyRevision:'2.1'};
 hub.invalidateSnapshot(client,common);hub.invalidateSnapshot(client,common);assert.equal(frames.length,1);
 hub.invalidateSnapshot(client,{...common,historyRevision:'2.2'});assert.equal(frames.length,2);
});
test('compact batches serialize common state once and keep personal overlays separate',async()=>{
 let encodes=0;
 const shared={toJSON(){encodes++;return {sessionId:session,status:'LIVE',version:2,deliveryMode:'compact'};}};
 const frames=[[],[]];
 const rpc=async(path,body)=>{
  if(path.endsWith('student-grant'))return grant(body.participantToken);
  assert.equal(body.compact,true);
  return {permissionDeadline:4750,allowed:['one','two'],shared,splitSnapshot:true,oversized:[],
   overlays:{one:{myVote:1,historyRevision:'0.1'},two:{myVote:2,historyRevision:'0.2'}}};
 };
 const hub=new RealtimeHub(rpc,{now:()=>0});
 for(const [i,person] of ['one','two'].entries()){
  const response=new Response();response.write=frame=>{frames[i].push(frame);return true;};
  await hub.addStudent('ABCD',person,response,false,true);
 }
 const room=hub.rooms.get('ABCD');await hub.refresh(room);
 assert.equal(encodes,1);
 for(let i=0;i<2;i++){
  const payload=JSON.parse(frames[i].at(-1).split('data: ')[1]);
  assert.equal(payload.myVote,i+1);assert.equal(payload.historyRevision,`0.${i+1}`);assert.equal(payload.version,2);
 }
 hub.close();
});
