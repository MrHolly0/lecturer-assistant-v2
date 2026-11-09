import { AccessToken, TrackSource, TokenVerifier } from 'livekit-server-sdk';
import { monotonicEpoch } from '../common/runtime.mjs';
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const roomId = name => name.startsWith('lecture-') && UUID.test(name.slice(8)) ? name.slice(8) : null;
export async function parallel(items, limit, action) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) { const item = items[index++]; await action(item); }
  }));
}

export class MediaAccess {
  constructor(rpc, rooms, { apiKey, apiSecret, publicUrl, now = monotonicEpoch }) {
    Object.assign(this, { rpc, rooms, apiKey, apiSecret, publicUrl, now });
    this.verifier = new TokenVerifier(apiKey, apiSecret);
  }

  async authorize(ids, roomIds = []) {
    const response = await this.rpc('/internal/v1/media/authorize', { grants: ids, rooms: roomIds });
    if (!Number.isFinite(response.permissionDeadline) || response.permissionDeadline <= this.now())
      throw new Error('Expired media authority');
    return response;
  }

  async ticket(id) {
    if (!UUID.test(id)) throw Object.assign(new Error('Invalid grant'), { status: 400 });
    const response = await this.authorize([id]);
    const grant = response.grants.find(g => g.id === id);
    if (!grant) throw Object.assign(new Error('Media permission revoked'), { status: 403 });
    const token = new AccessToken(this.apiKey, this.apiSecret, { identity: id, ttl: 30 });
    token.addGrant({ roomJoin: true, room: grant.room, canPublish: grant.publisher, canSubscribe: !grant.publisher,
      canPublishData: false, canUpdateOwnMetadata: false,
      canPublishSources: grant.publisher ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [] });
    return { url: this.publicUrl, token: await token.toJwt(), room: grant.room, expiresAt: response.expiresAt };
  }

  async permitSignal(token) {
    const claims = await this.verifier.verify(token);
    if (!UUID.test(claims.sub) || !roomId(claims.video?.room ?? '')) throw new Error('Invalid media claims');
    const response = await this.authorize([claims.sub]);
    const grant = response.grants.find(g => g.id === claims.sub);
    if (!grant || grant.room !== claims.video.room || Boolean(claims.video.canPublish) !== grant.publisher)
      throw new Error('Media access revoked');
  }

  /** Complete sweep first, then renew supervisors. Partial checks never extend an SFU's lease. */
  async sweep(inventory) {
    if (!Array.isArray(inventory)) throw new Error('Local SFU inventory required');
    const rooms = inventory;
    if (rooms.length > 128) throw new Error('Media room admission exceeded');
    const audiences = new Map();
    await parallel(rooms, 16, async room => {
      const participants = room.participants;
      if (!Array.isArray(participants)) throw new Error('Invalid local participant inventory');
      if (participants.length > 1500) throw new Error('Media room admission exceeded');
      audiences.set(room.name, participants);
    });
    const ids = [...new Set([...audiences.values()].flat().map(p => p.identity).filter(id => UUID.test(id)))];
    const subjectRooms = new Map();
    audiences.forEach((people, name) => people.forEach(p => subjectRooms.set(p.identity, roomId(name))));
    const emptyRooms = rooms.filter(r => !audiences.get(r.name).some(p => UUID.test(p.identity))).map(r => roomId(r.name));
    if (ids.length > 20000) throw new Error('Media installation admission exceeded');
    let until = Infinity;
    const allowed = new Map(), allowedRooms = new Set();
    const batches = [];
    for (let i = 0; i < ids.length; i += 1000) batches.push(ids.slice(i, i + 1000));
    if (!batches.length) batches.push([]);
    await parallel(batches, 16, async batch => {
      const batchRooms = [...new Set(batch.map(id => subjectRooms.get(id)))];
      const state = await this.authorize(batch, batch === batches[0] ? [...batchRooms, ...emptyRooms] : batchRooms);
      until = Math.min(until, state.permissionDeadline);
      state.rooms.forEach(id => allowedRooms.add(id));
      state.grants.forEach(grant => allowed.set(grant.id, grant));
    });
    await parallel(rooms, 16, async room => {
      if (!allowedRooms.has(roomId(room.name))) { await this.rooms.deleteRoom(room.name); return; }
      await parallel(audiences.get(room.name), 16, async person => {
        const grant = allowed.get(person.identity);
        if (!grant || grant.room !== room.name || Boolean(person.permission?.canPublish) !== grant.publisher
            || Boolean(person.permission?.canSubscribe) === grant.publisher)
          await this.rooms.removeParticipant(room.name, person.identity);
      });
    });
    if (until <= this.now()) throw new Error('Media sweep exceeded lease');
    return until;
  }
}
