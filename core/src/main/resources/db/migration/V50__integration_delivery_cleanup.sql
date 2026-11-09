ALTER TABLE integration.outbox DROP CONSTRAINT outbox_status_check;
ALTER TABLE integration.outbox ADD CONSTRAINT outbox_status_check
    CHECK (status IN ('QUEUED', 'IN_FLIGHT', 'DEAD', 'DELIVERED'));
CREATE INDEX outbox_cleanup ON integration.outbox(lane, created_at) WHERE status = 'DELIVERED';
