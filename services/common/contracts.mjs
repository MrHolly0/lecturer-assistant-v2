const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function integrationEvent(value) {
  return value && value.schemaVersion === 1 && uuid(value.eventId) && value.audience === 'INTERNAL'
    && typeof value.type === 'string' && value.type.length > 0 && value.type.length <= 128
    && typeof value.occurredAt === 'string' && Number.isFinite(Date.parse(value.occurredAt))
    && (value.sessionId === null || uuid(value.sessionId)) && uuid(value.aggregate?.id)
    && typeof value.aggregate?.type === 'string' && value.aggregate.type.length > 0
    && Number.isSafeInteger(value.aggregate?.revision) && value.aggregate.revision > 0
    && value.data && typeof value.data === 'object' && !Array.isArray(value.data);
}
