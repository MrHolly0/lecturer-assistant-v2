// Temporary loopback-only media test harness. No credentials are served with the page or logged.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
if (process.env.SCALE_LAB !== 'true') throw new Error('Requires isolated lab');
const base = 'http://localhost:18089';
const f = JSON.parse(await readFile('/private/tmp/lecturer-scale-fixture.json'));
async function api(path, body, headers = {}, method = 'POST') {
  const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Harness API status ' + response.status);
  return response.status === 204 ? null : response.json();
}
const auth = await api('/auth/login', { email: f.email, password: f.password });
const staff = { Authorization: 'Bearer ' + auth.accessToken };
const fresh = process.env.SCALE_MEDIA_FRESH_SESSION === 'true';
const viewerCount = Number(process.env.SCALE_MEDIA_VIEWERS ?? 1);
if (!Number.isInteger(viewerCount) || viewerCount < 1 || viewerCount > 32)
  throw new Error('Viewer count must be within 1..32');
if (fresh) {
  const lecture = await api(`/courses/${f.course.id}/lectures`, {
    title: 'Isolated media capacity ' + randomUUID(), deckId: f.deck.id
  }, staff);
  f.session = await api(`/courses/${f.course.id}/lectures/${lecture.id}/sessions`,
    { groups: [{ groupName: 'Synthetic media viewers' }] }, staff);
  await api(`/courses/${f.course.id}/sessions/${f.session.id}/begin`, undefined, staff);
}
const path = `/courses/${f.course.id}/sessions/${f.session.id}/sfu-share`;
const room = await api(path, { sourceName: 'Synthetic browser test' }, staff);
const viewers = [];
for (let i = 0; i < viewerCount; i++) {
  const student = fresh || viewerCount > 1 ? await api(`/student/sessions/${f.session.joinCode}/join`,
    { displayName: `Synthetic media viewer ${i}` }) : f.students[1];
  viewers.push({ path: `/student/sessions/${f.session.joinCode}/sfu-share/${randomUUID()}`,
    headers: { 'X-Participant-Token': student.participantToken } });
}
const pulse = setInterval(() => void api(path + '/' + room.id, undefined, staff, 'GET').catch(() => {}), 3000);
const presence = setInterval(() => void api(path.replace('/sfu-share', '/presenter-presence'), undefined, staff)
  .catch(() => {}), 30000);
const viewerPulse = setInterval(() => {
  for (const viewer of viewers) void api(viewer.path, undefined, viewer.headers).catch(() => {});
}, 15000);
const html = `<!doctype html><meta charset="utf-8"><title>Isolated SFU media test</title>
<style>body{font:24px sans-serif;background:#fff;color:#111}video,canvas{max-width:95vw;border:1px solid #aaa}</style>
<h1>Isolated SFU media test</h1><div id="status">Ready</div><video id="video" autoplay muted playsinline></video>
<script src="/sdk.js"></script><script>
window.framesDecoded=()=>document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames;
window.videoStats=async()=>{
 const stats=await window.remoteTrack?.getReceiverStats();const video=document.querySelector('video');
 return {framesDecoded:stats?.framesDecoded??0,displayedFrames:window.framesDecoded(),
  frameWidth:video.videoWidth,frameHeight:video.videoHeight,bytesReceived:stats?.bytesReceived??0,
  packetsReceived:stats?.packetsReceived??0,packetsLost:stats?.packetsLost??0,timestamp:stats?.timestamp??0};
};
window.start=async(role,viewer=0)=>{
 const ticket=await(await fetch('/ticket?role='+role+'&viewer='+viewer)).json();
 const room=new LivekitClient.Room({adaptiveStream:false,dynacast:false}); window.room=room;
 room.on(LivekitClient.RoomEvent.TrackSubscribed,track=>{
  if(track.kind==='video'){window.remoteTrack=track;track.attach(document.querySelector('video'));document.querySelector('#status').textContent='Receiving';}
 });
 await room.connect(ticket.url,ticket.token,{autoSubscribe:role!=='publisher'});
 if(role==='publisher'){
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;document.body.append(canvas);
  const ctx=canvas.getContext('2d');let frame=0;
  window.draw=setInterval(()=>{ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#102030';ctx.font='22px monospace';
   ctx.fillText('const result = await lecture.receive();',50,100);ctx.fillText('Frame '+frame++,50,150);
   ctx.fillStyle=frame%2?'#ff6500':'#0065ff';ctx.fillRect(50,200,500,200);},66);
  await room.localParticipant.publishTrack(canvas.captureStream(15).getVideoTracks()[0],
   {source:LivekitClient.Track.Source.ScreenShare,simulcast:false,videoEncoding:{maxBitrate:6000000,maxFramerate:15}});
 }
 document.querySelector('#status').textContent=role==='publisher'?'Publishing':'Connected';return true;
};</script>`;
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }).end(html); return; }
    if (request.url === '/sdk.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(await readFile('web/node_modules/livekit-client/dist/livekit-client.umd.js')); return;
    }
    const role = new URL(request.url, 'http://localhost').searchParams.get('role');
    if (request.url.startsWith('/ticket?') && ['publisher', 'subscriber'].includes(role)) {
      const index = Number(new URL(request.url, 'http://localhost').searchParams.get('viewer') ?? 0);
      if (!Number.isInteger(index) || index < 0 || index >= viewers.length) {
        response.writeHead(400).end('{}'); return;
      }
      const ticket = role === 'publisher' ? await api(path + '/' + room.id + '/ticket', undefined, staff)
        : (await api(viewers[index].path, undefined, viewers[index].headers)).ticket;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(ticket));
      return;
    }
    response.writeHead(404).end();
  } catch { response.writeHead(503).end('{}'); }
});
server.listen(18090, '127.0.0.1', () => console.log('Isolated media harness ready'));
const stop = async () => {
  clearInterval(pulse); clearInterval(presence); clearInterval(viewerPulse);
  server.close(); server.closeAllConnections();
  await api(path + '/' + room.id, undefined, staff, 'DELETE').catch(() => {});
  if (fresh) await api(`/courses/${f.course.id}/sessions/${f.session.id}/end`, undefined, staff).catch(() => {});
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);
