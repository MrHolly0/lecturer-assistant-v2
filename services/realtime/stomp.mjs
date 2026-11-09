const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attachStomp(socket, sessionId, hub) {
  if (!SESSION.test(sessionId)) { socket.close(1008); return; }
  let client, buffer = '', pendingBytes = 0, serial = Promise.resolve(), connecting = false;
  const forceClose = () => {
    socket.close(1008, 'Invalid subscription');
    const timer = setTimeout(() => { if (socket.readyState !== 3) socket.terminate(); }, 1000); timer.unref();
  };
  const handshake = setTimeout(() => { if (!client) forceClose(); }, 5000);
  handshake.unref();
  const reject = () => { forceClose(); hub.remove(client); };
  socket.on('close', () => { clearTimeout(handshake); hub.remove(client); });
  socket.on('error', () => { clearTimeout(handshake); hub.remove(client); });
  socket.on('message', bytes => {
    if (client) client.lastReceived = hub.now();
    if (bytes.length + pendingBytes > 65536) { reject(); return; }
    buffer += bytes.toString();
    if (!buffer.trim()) { buffer = ''; return; }
    const frames = buffer.split('\0'); buffer = frames.pop();
    pendingBytes = Buffer.byteLength(buffer);
    for (const raw of frames) {
      const frame = raw.replace(/^\n+/, '');
      const size = Buffer.byteLength(frame); pendingBytes += size;
      if (pendingBytes > 65536) { reject(); return; }
      serial = serial.then(async () => {
        const [command, ...lines] = frame.split('\n\n')[0].split('\n');
        const headers = Object.fromEntries(lines.map(line => {
          const split = line.indexOf(':');
          return [line.slice(0, split), line.slice(split + 1).replace(/\r$/, '')];
        }));
        if (command === 'CONNECT' || command === 'STOMP') {
          if (client || connecting) throw new Error('Already connected');
          connecting = true;
          const auth = headers.Authorization ?? headers.authorization ?? '';
          if (!auth.startsWith('Bearer ') || auth.length > 8192) throw new Error('Missing token');
          client = await hub.addPresenter(sessionId, auth.slice(7), socket);
          if (!client) return;
          clearTimeout(handshake);
          socket.send('CONNECTED\nversion:1.2\nheart-beat:10000,10000\n\n\0');
        } else if (!client || !hub.valid(client)) throw new Error('Not authorized');
        else if (command === 'SUBSCRIBE') {
          if (headers.destination !== `/topic/session/${sessionId}` || !headers.id || headers.id.length > 64
              || !/^[a-zA-Z0-9_-]+$/.test(headers.id)) throw new Error('Invalid destination');
          client.subscription = headers.id;
          hub.presenterSnapshot(client, client.initialSession, 'session.snapshot');
          client.room.dirty = true; client.room.due = 0;
        } else if (command === 'UNSUBSCRIBE') client.subscription = null;
        else if (command === 'DISCONNECT') socket.close(1000);
        else if (command !== 'ACK' && command !== 'NACK') throw new Error('Commands require HTTP');
      }).catch(reject).finally(() => { pendingBytes -= size; });
    }
  });
}
