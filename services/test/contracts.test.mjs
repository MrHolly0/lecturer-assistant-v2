import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrationEvent } from '../common/contracts.mjs';
const id = '00000000-0000-4000-8000-000000000001';
test('integration v1 validates identity, ordering, audience and nullable session scope', () => {
  const valid = { eventId: id, schemaVersion: 1, type: 'session.ended', sessionId: id,
    aggregate: { type: 'session', id, revision: 1 }, audience: 'INTERNAL', data: {}, occurredAt: new Date().toISOString() };
  assert.equal(Boolean(integrationEvent(valid)), true);
  assert.equal(Boolean(integrationEvent({ ...valid, sessionId: null })), true);
  for (const invalid of [{ ...valid, schemaVersion: 2 }, { ...valid, sessionId: undefined },
    { ...valid, audience: 'PUBLIC' }, { ...valid, eventId: 'broken' },
    { ...valid, aggregate: { ...valid.aggregate, revision: 0 } }, { ...valid, occurredAt: 'invalid' }])
    assert.equal(Boolean(integrationEvent(invalid)), false);
});
