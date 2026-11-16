// Real bounded scale up/down proof, confined to the disposable single-VM acceptance lab.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(process.env.APPLIANCE_LAB!=='true') throw new Error('Explicit disposable appliance lab required');
const fixture=JSON.parse(await readFile('/private/tmp/lecturer-appliance-lab/fixture.json'));
const base='http://127.0.0.1:18094', clients=[], report={phases:[]};
async function kube(...args){return (await exec('docker',['exec','lecturer-appliance-lab-k3s-1','kubectl','-n','lecturer',...args],{timeout:20000})).stdout;}
async function until(label,test,deadline=180000){const start=Date.now();while(Date.now()-start<deadline){if(await test()){report.phases.push({label,ms:Date.now()-start});console.log(label);return;}await sleep(2000);}throw new Error('Timeout: '+label);}
async function replicas(n){const s=JSON.parse(await kube('get','deployment/realtime','-o','json'));return s.spec.replicas===n&&(s.status.readyReplicas??0)===n;}
const original=JSON.parse(await kube('get','scaledobject/realtime','-o','json'));
try{
 const spec=structuredClone(original.spec);spec.triggers[0].metadata.threshold='10';
 spec.advanced.horizontalPodAutoscalerConfig.behavior.scaleDown.stabilizationWindowSeconds=0;
 await kube('patch','scaledobject/realtime','--type=merge','-p',JSON.stringify({spec}));
 await until('baseline-one',()=>replicas(1));
 for(let i=0;i<35;i++){
  const joined=await fetch(base+'/api/v1/student/sessions/'+fixture.session.joinCode+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:'Autoscale '+i})});
  assert.equal(joined.status,200);const participant=await joined.json();
  const controller=new AbortController();const response=await fetch(base+'/api/v1/student/sessions/'+fixture.session.joinCode+'/events?'+new URLSearchParams({participantToken:participant.participantToken}),{signal:controller.signal});
  assert.equal(response.status,200);
  const client={controller,snapshots:0};clients.push(client);
  client.task=(async()=>{let text='';try{for await(const bytes of response.body){text+=new TextDecoder().decode(bytes);let cut;while((cut=text.indexOf('\n\n'))>=0){if(text.slice(0,cut).startsWith('event: snapshot'))client.snapshots++;text=text.slice(cut+2);}}}catch(error){if(!controller.signal.aborted)throw error;}})();
 }
 await until('all-connected',async()=>clients.every(c=>c.snapshots>0));
 await until('scaled-to-three',()=>replicas(3));
 report.connections=clients.length;report.initialSnapshots=clients.reduce((sum,c)=>sum+c.snapshots,0);
 for(const client of clients)client.controller.abort();
 await Promise.all(clients.map(c=>c.task));
 await until('scaled-back-to-one',()=>replicas(1),240000);
 report.passed=true;
}finally{
 for(const client of clients)client.controller.abort();
 await Promise.allSettled(clients.map(c=>c.task));
 await kube('patch','scaledobject/realtime','--type=merge','-p',JSON.stringify({spec:original.spec}));
 await writeFile(process.env.APPLIANCE_REPORT??'/private/tmp/lecturer-appliance-lab/autoscaling.json',JSON.stringify(report,null,2));
}
