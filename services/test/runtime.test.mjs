import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcClient } from '../common/runtime.mjs';

test('permission deadlines tolerate clock skew without granting extra time for RPC latency', async () => {
  let time = 100000;
  const fetcher = async () => {
    time += 1200;
    // Authority wall clock can be arbitrarily different from this process's epoch.
    return Response.json({ checkedAt: '2000-01-01T00:00:00Z', expiresAt: '2000-01-01T00:00:05Z' });
  };
  const rpc = rpcClient('http://authority', 'test', fetcher, () => time);
  const grant = await rpc('/grant', {});
  assert.equal(grant.permissionDeadline, 104750);
  assert.equal(grant.permissionDeadline - time, 3550);
  assert.ok(!JSON.stringify(grant).includes('permissionDeadline'));
});

test('a response delayed beyond its whole permission interval cannot renew access', async () => {
  let time = 100000;
  const rpc = rpcClient('http://authority', 'test', async () => {
    time += 8000;
    return Response.json({ checkedAt: '2000-01-01T00:00:00Z', expiresAt: '2000-01-01T00:00:05Z' });
  }, () => time);
  assert.ok((await rpc('/grant', {})).permissionDeadline < time);
});

test('authority cannot issue an unbounded permission interval', async () => {
  const rpc = rpcClient('http://authority', 'test', async () => Response.json({
    checkedAt: '2000-01-01T00:00:00Z', expiresAt: '2000-01-01T00:00:06Z'
  }));
  await assert.rejects(rpc('/grant', {}), /Invalid permission lease/);
});
