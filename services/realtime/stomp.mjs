const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attachStomp(socket, sessionId, hub) {
  if (!SESSION.test(sessionId)) { socket.close(1008); return; }
  let client, buffer = Buffer.alloc(0), queuedBytes = 0, queuedFrames = 0;
  let serial = Promise.resolve(), connecting = false, closed = false, windowStart = hub.now(), messages = 0;
  const forceClose = (code = 1008) => {
    if (closed) return;
    closed = true; buffer = Buffer.alloc(0);
    clearTimeout(handshake); hub.remove(client);
    socket.close(code, code === 1013 ? 'Retry later' : 'Invalid subscription');
    const timer = setTimeout(() => { if (socket.readyState !== 3) socket.terminate(); }, 1000); timer.unref();
  };
  const handshake = setTimeout(() => { if (!client) forceClose(); }, 5000);
  handshake.unref();
  const reject = error => { forceClose(error?.status === 503 ? 1013 : 1008); hub.remove(client); };
  socket.on('close', () => { closed = true; buffer = Buffer.alloc(0); clearTimeout(handshake); hub.remove(client); });
  socket.on('error', () => { closed = true; buffer = Buffer.alloc(0); clearTimeout(handshake); hub.remove(client); });
  socket.on('message', bytes => {
    if (closed) return;
    if (hub.now() - windowStart >= 1000) { windowStart = hub.now(); messages = 0; }
    if (++messages > 128 || bytes.length + buffer.length + queuedBytes > 65536) { reject(); return; }
    if (client) client.lastReceived = hub.now();
    buffer = Buffer.concat([buffer, Buffer.from(bytes)]);
    // Heartbeats count toward rate admission but never erase queued command bytes.
    if (buffer.every(byte => byte === 10 || byte === 13)) { buffer = Buffer.alloc(0); return; }
    let end;
    while ((end = buffer.indexOf(0)) >= 0) {
      const size = end + 1;
      const frame = buffer.subarray(0, end).toString().replace(/^\n+/, '');
      buffer = buffer.subarray(size);
      if (++queuedFrames > 64) { reject(); return; }
      queuedBytes += size;
      serial = serial.then(async () => {
        if (closed) return;
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
          if (closed) { hub.remove(client); return; }
          if (!client) return;
          clearTimeout(handshake);
          socket.send('CONNECTED\nversion:1.2\nheart-beat:10000,10000\n\n\0');
        } else if (!client || !hub.valid(client)) throw new Error('Not authorized');
        else if (command === 'SUBSCRIBE') {
          if (headers.destination !== `/topic/session/${sessionId}` || !headers.id || headers.id.length > 64
              || !/^[a-zA-Z0-9_-]+$/.test(headers.id)) throw new Error('Invalid destination');
          client.subscription = headers.id;
          if (client.initialSession) hub.presenterSnapshot(client, client.initialSession, 'session.snapshot');
          client.initialSession = undefined;
          client.room.dirty = true; client.room.due = 0;
        } else if (command === 'UNSUBSCRIBE') client.subscription = null;
        else if (command === 'DISCONNECT') socket.close(1000);
        else if (command !== 'ACK' && command !== 'NACK') throw new Error('Commands require HTTP');
      }).catch(reject).finally(() => { queuedBytes -= size; queuedFrames--; });
    }
  });
}
