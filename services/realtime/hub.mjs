import { createHash, randomUUID } from 'node:crypto';
import { monotonicEpoch } from '../common/runtime.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const terminal = snapshot => ['ENDED', 'ARCHIVED'].includes(snapshot.status);
const lease = (grant, now) => Number.isFinite(grant.permissionDeadline)
  ? Math.min(grant.permissionDeadline, now + 4750) : 0;

/** Connections are disposable. Only the authority owns participants and lecture state. */
export class RealtimeHub {
  constructor(rpc, { maxConnections = 6000, maxRooms = 1024, concurrency = 16,
    grantConcurrency = 8, maxFrameBytes = 16384, maxBufferBytes = 32768, now = monotonicEpoch } = {}) {
    Object.assign(this, { rpc, maxConnections, maxRooms, concurrency, grantConcurrency,
      maxFrameBytes, maxBufferBytes, now });
    this.clients = new Set(); this.rooms = new Map(); this.sessions = new Map();
    this.inFlight = 0; this.pendingGrants = 0; this.cursor = 0; this.closed = false;
    this.studentCount = 0; this.pendingStudents = 0;
    this.stats = { snapshots: 0, coalesced: 0, slowConsumers: 0, revoked: 0, rpcErrors: 0,
      invalidations: 0, matchedInvalidations: 0, expiredLeases: 0, denied: 0, staleGrants: 0,
      rpcMaxMs: 0, tickMaxGapMs: 0 };
    this.lastTick = this.now();
    this.rpc = async (...args) => {
      const started = this.now();
      try { return await rpc(...args); }
      finally { this.stats.rpcMaxMs = Math.max(this.stats.rpcMaxMs, this.now() - started); }
    };
  }

  admit() {
    if (this.closed || this.pendingGrants >= this.grantConcurrency
        || this.clients.size + this.pendingGrants >= this.maxConnections)
      throw Object.assign(new Error('Gateway at capacity'), { status: 503 });
  }

  room(code, sessionId) {
    let room = this.rooms.get(code);
    if (room) return room;
    if (this.rooms.size >= this.maxRooms) throw Object.assign(new Error('Room limit'), { status: 503 });
    room = { code, sessionId, clients: new Set(), dirty: true, eventType: 'session.snapshot',
      due: 0, lastSnapshot: 0, lastPresence: 0, busy: false };
    this.rooms.set(code, room);
    if (sessionId) this.sessions.set(sessionId, room);
    return room;
  }

  async addStudent(code, token, response, isPublic = false) {
    this.admit(); this.pendingGrants++; this.pendingStudents++;
    let client;
    try {
      const grant = isPublic
        ? { snapshot: await this.rpc('/internal/v1/realtime/public-snapshot', { joinCode: code }) }
        : await this.rpc('/internal/v1/realtime/student-grant', { joinCode: code, participantToken: token });
      if (response.destroyed || this.closed) return;
      const expiresAt = isPublic ? Infinity : lease(grant, this.now());
      if (expiresAt <= this.now()) throw Object.assign(new Error('Expired grant'), { status: 503 });
      const room = this.room(code, grant.snapshot.sessionId);
      client = { id: randomUUID(), kind: 'sse', response, room, isPublic,
        personId: grant.personId, authVersion: grant.authVersion,
        expiresAt,
        lastHeartbeat: this.now(), lastHash: '', pending: null, blocked: false };
      if (client.expiresAt <= this.now()) throw Object.assign(new Error('Expired grant'), { status: 503 });
      response.writeHead(200, { 'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff' });
      response.flushHeaders?.();
      response.on('close', () => this.remove(client));
      response.on('error', () => this.remove(client));
      response.on('drain', () => {
        client.blocked = false;
        const frame = client.pending; client.pending = null;
        if (frame && this.valid(client)) this.write(client, frame);
      });
      this.clients.add(client); room.clients.add(client); this.studentCount++;
      this.snapshot(client, grant.snapshot);
      return client;
    } finally { this.pendingGrants--; this.pendingStudents--; }
  }

  async addPresenter(sessionId, accessToken, socket) {
    this.admit(); this.pendingGrants++;
    try {
      const grant = await this.rpc('/internal/v1/realtime/presenter-grant', { sessionId, accessToken });
      if (socket.readyState !== 1 || this.closed) return;
      const expiresAt = lease(grant, this.now());
      if (expiresAt <= this.now()) throw Object.assign(new Error('Expired grant'), { status: 503 });
      const room = this.room(grant.session.joinCode, sessionId);
      const client = { id: randomUUID(), kind: 'ws', socket, room, accessToken, sessionId,
        expiresAt, lastHeartbeat: this.now(),
        lastReceived: this.now(), subscription: null, nextGrant: 0, pending: null };
      if (client.expiresAt <= this.now()) throw Object.assign(new Error('Expired grant'), { status: 503 });
      this.clients.add(client); room.clients.add(client);
      client.initialSession = grant.session;
      return client;
    } finally { this.pendingGrants--; }
  }

  valid(client) { return this.clients.has(client) && client.expiresAt > this.now(); }

  remove(client) {
    if (!client || !this.clients.delete(client)) return;
    if (client.kind === 'sse') this.studentCount--;
    client.pending = null;
    client.room.clients.delete(client);
    if (!client.room.clients.size) {
      this.rooms.delete(client.room.code);
      this.sessions.delete(client.room.sessionId);
    }
  }

  closeClient(client, revoked = false) {
    if (revoked) this.stats.revoked++;
    this.remove(client);
    if (client.kind === 'sse') client.response.end();
    else client.socket.close(1008, revoked ? 'Permission expired' : 'Reconnect');
  }

  write(client, frame) {
    if (!this.valid(client)) return;
    const response = client.response;
    if (response.destroyed) { this.remove(client); return; }
    if (response.writableLength + Buffer.byteLength(frame) > this.maxBufferBytes) {
      this.stats.slowConsumers++; response.destroy(); this.remove(client); return;
    }
    if (client.blocked) { client.pending = frame; this.stats.coalesced++; return; }
    client.blocked = !response.write(frame);
  }

  snapshot(client, snapshot) {
    if (snapshot.gatewayInvalidation) { this.invalidateSnapshot(client, snapshot); return; }
    const text = JSON.stringify(snapshot), hash = digest(text);
    if (client.lastHash === hash) return;
    client.lastHash = hash;
    const frame = Buffer.byteLength(text) <= this.maxFrameBytes
      ? `event: snapshot\ndata: ${text}\n\n`
      : `event: invalidate\ndata: ${JSON.stringify({ sessionId: snapshot.sessionId, version: snapshot.version })}\n\n`;
    this.write(client, frame); this.stats.snapshots++;
    if (terminal(snapshot) && Buffer.byteLength(text) <= this.maxFrameBytes && !client.blocked)
      this.closeClient(client);
  }

  invalidateSnapshot(client, snapshot) {
    client.lastHash = '';
    this.write(client, `event: invalidate\ndata: ${JSON.stringify({ sessionId: snapshot.sessionId,
      version: snapshot.version })}\n\n`);
  }

  presenterSnapshot(client, session, type) {
    if (!this.valid(client) || !client.subscription || client.socket.readyState !== 1) return;
    if (client.socket.bufferedAmount > 262144) {
      this.stats.slowConsumers++; client.socket.terminate(); this.remove(client); return;
    }
    let body = JSON.stringify({ type, session });
    if (Buffer.byteLength(body) > 262144)
      body = JSON.stringify({ type: 'session.invalidate', sessionId: session.id,
        version: session.version, eventType: type });
    client.socket.send(`MESSAGE\nsubscription:${client.subscription}\ndestination:/topic/session/${session.id}\ncontent-type:application/json\n\n${body}\0`);
  }

  invalidate(event) {
    if (!event || event.schemaVersion !== 1 || !event.sessionId) return;
    this.stats.invalidations++;
    const room = this.sessions.get(event.sessionId);
    if (room) {
      this.stats.matchedInvalidations++;
      room.dirty = true; room.eventType = event.type; room.due = 0;
    }
  }

  tick() {
    const now = this.now();
    this.stats.tickMaxGapMs = Math.max(this.stats.tickMaxGapMs, now - this.lastTick);
    this.lastTick = now;
    for (const client of this.clients) {
      if (client.expiresAt <= now) { this.stats.expiredLeases++; this.closeClient(client, true); continue; }
      if (client.kind === 'ws' && now - client.lastReceived > 45000) {
        this.closeClient(client); continue;
      }
      if (now - client.lastHeartbeat >= (client.kind === 'sse' ? 15000 : 10000)) {
        client.lastHeartbeat = now;
        if (client.kind === 'sse') this.write(client, 'event: keepalive\ndata: {}\n\n');
        else if (client.socket.readyState === 1) client.socket.send('\n');
      }
    }
    const rooms = [...this.rooms.values()];
    if (!rooms.length) return;
    const offset = this.cursor++ % rooms.length;
    for (let i = 0; i < rooms.length && this.inFlight < this.concurrency; i++) {
      const room = rooms[(i + offset) % rooms.length];
      if (room.busy || room.due > now) continue;
      room.busy = true; this.inFlight++;
      void this.refresh(room).catch(() => { this.stats.rpcErrors++; room.dirty = true; }).finally(() => {
        room.busy = false; room.due = this.now() + (room.dirty ? 250 : 1800 + Math.random() * 400); this.inFlight--;
      });
    }
  }

  async refresh(room) {
    const audience = [...room.clients];
    const includeSnapshots = room.dirty || this.now() - room.lastSnapshot >= 15000;
    const eventType = room.eventType;
    room.dirty = false;
    const students = audience.filter(c => c.kind === 'sse' && !c.isPublic);
    const subjects = [...new Map(students.map(c => [c.personId, {
      personId: c.personId, authVersion: c.authVersion
    }])).values()];
    // Cap response memory as well as subject count: private overlays can be up to 8 KiB each.
    for (let i = 0; i < subjects.length; i += 128) {
      const chunk = subjects.slice(i, i + 128);
      const response = await this.rpc('/internal/v1/realtime/student-batch', {
        joinCode: room.code, subjects: chunk, includeSnapshots
      });
      const allowed = new Set(response.allowed), chunkIds = new Set(chunk.map(s => s.personId));
      for (const client of students.filter(c => chunkIds.has(c.personId))) {
        if (!this.clients.has(client)) continue;
        if (!allowed.has(client.personId)) { this.stats.denied++; this.closeClient(client, true); continue; }
        client.expiresAt = lease(response, this.now());
        if (!this.valid(client)) { this.stats.staleGrants++; this.closeClient(client, true); continue; }
        if (includeSnapshots && response.shared) {
          if (response.shared.gatewayInvalidation || response.oversized.includes(client.personId))
            this.invalidateSnapshot(client, response.shared);
          else if (response.overlays[client.personId])
            this.snapshot(client, { ...response.shared, ...response.overlays[client.personId] });
        }
      }
    }
    const publicClients = audience.filter(c => c.kind === 'sse' && c.isPublic);
    if (includeSnapshots && publicClients.length) {
      const snapshot = await this.rpc('/internal/v1/realtime/public-snapshot', { joinCode: room.code });
      for (const client of publicClients) this.snapshot(client, snapshot);
    }
    const presenters = audience.filter(c => c.kind === 'ws');
    for (const client of presenters) {
      if (!this.clients.has(client)) continue;
      try {
        const grant = await this.rpc('/internal/v1/realtime/presenter-grant', {
          sessionId: client.sessionId, accessToken: client.accessToken
        });
        client.expiresAt = lease(grant, this.now());
        if (!this.valid(client)) { this.closeClient(client, true); continue; }
        if (includeSnapshots) this.presenterSnapshot(client, grant.session, eventType);
      } catch (error) {
        if ([401, 403, 404].includes(error.status)) this.closeClient(client, true);
        else throw error;
      }
    }
    if (presenters.some(c => this.valid(c) && c.subscription) && this.now() - room.lastPresence >= 30000) {
      await this.rpc('/internal/v1/realtime/presenter-presence', { sessionId: room.sessionId });
      room.lastPresence = this.now();
    }
    if (includeSnapshots) room.lastSnapshot = this.now();
  }

  close() {
    this.closed = true;
    for (const client of [...this.clients]) this.closeClient(client);
  }
}
