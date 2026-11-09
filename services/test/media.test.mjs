import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import { MediaAccess } from '../media-control/access.mjs';
import { SfuWatchdog } from '../media-supervisor/watchdog.mjs';
import { monotonicEpoch } from '../common/runtime.mjs';
const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const roomId = '00000000-0000-4000-8000-000000000003';
const name = `lecture-${roomId}`;
const apiKey = 'test-media-key-00000000000000000000', apiSecret = 'test-media-secret-0000000000000000';

test('subscriber token cannot publish, send data or join another room; replay is reauthorized', async () => {
  let allowed = true;
  const rpc = async () => ({ permissionDeadline: monotonicEpoch() + 4750,
    expiresAt: new Date(Date.now() + 5000).toISOString(), rooms: [roomId],
    grants: allowed ? [{ id, roomId, room: name, publisher: false }] : [] });
  const media = new MediaAccess(rpc, {}, { apiKey, apiSecret, publicUrl: 'wss://media.test' });
  const ticket = await media.ticket(id);
  const decoded = await new TokenVerifier(apiKey, apiSecret).verify(ticket.token);
  assert.equal(decoded.video.canPublish, false);
  assert.equal(decoded.video.canSubscribe, true);
  assert.equal(decoded.video.canPublishData, false);
  assert.equal(decoded.video.room, name);
  await media.permitSignal(ticket.token);
  allowed = false;
  await assert.rejects(media.permitSignal(ticket.token), /revoked/);
});

test('access sweep removes unauthorized viewers, deletes ended rooms, and never blesses a partial failure', async () => {
  const removed = [], deleted = [];
  let broken = false;
  const rooms = {
    listRooms: async () => [{ name }, { name: `lecture-${other}` }],
    listParticipants: async () => [{ identity: id, permission: { canPublish: false, canSubscribe: true } },
      { identity: other, permission: { canPublish: true, canSubscribe: true } }],
    removeParticipant: async (room, person) => { if (broken) throw new Error('SFU control lost'); removed.push(person); },
    deleteRoom: async room => deleted.push(room)
  };
  const rpc = async () => ({ permissionDeadline: monotonicEpoch() + 4750,
    expiresAt: new Date(Date.now() + 5000).toISOString(), rooms: [roomId],
    grants: [{ id, roomId, room: name, publisher: false }] });
  const media = new MediaAccess(rpc, rooms, { apiKey, apiSecret });
  const inventory = [{ name, participants: await rooms.listParticipants() },
    { name: `lecture-${other}`, participants: [] }];
  assert.ok(await media.sweep(inventory) > Date.now());
  assert.deepEqual(removed, [other]); assert.deepEqual(deleted, [`lecture-${other}`]);
  broken = true;
  await assert.rejects(media.sweep(inventory), /SFU control lost/);
});

test('supervisor kills only its SFU child on expired authorization and rejects infinite leases', () => {
  let now = 100000, starts = 0; const killed = [];
  const watchdog = new SfuWatchdog({ now: () => now, start: () => ({ pid: ++starts }), stop: c => killed.push(c.pid) });
  assert.equal(watchdog.renew(now + 6000), false);
  assert.equal(watchdog.renew(now + 4500, true), true);
  now += 4000;
  watchdog.renew(now + 4500, true); // Bootstrap cannot extend a running child's lease.
  now += 501; watchdog.tick();
  assert.deepEqual(killed, [1]); assert.equal(watchdog.child, null);
  watchdog.renew(now + 4500, true); assert.equal(starts, 1); // bounded restart cooldown
  now += 10000; watchdog.renew(now + 4500); assert.equal(starts, 2);
  now += 4000; watchdog.renew(now + 4500); now += 1000; watchdog.tick();
  assert.equal(watchdog.child.pid, 2);
});

test('a local audit never calls a failed remote SFU or its global room inventory', async () => {
  const rooms = {
    listRooms: async () => { throw new Error('remote node is down'); },
    listParticipants: async () => { throw new Error('remote node is down'); },
    deleteRoom: async () => { throw new Error('unexpected delete'); }
  };
  const rpc = async () => ({ permissionDeadline: monotonicEpoch() + 4750,
    expiresAt: new Date(Date.now() + 5000).toISOString(), rooms: [roomId],
    grants: [{ id, roomId, room: name, publisher: false }] });
  const media = new MediaAccess(rpc, rooms, { apiKey, apiSecret });
  assert.ok(await media.sweep([{ name, participants: [{ identity: id,
    permission: { canPublish: false, canSubscribe: true } }] }]) > Date.now());
});
