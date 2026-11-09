CREATE SCHEMA IF NOT EXISTS integration;

CREATE TABLE integration.outbox_budgets (
    lane smallint PRIMARY KEY CHECK (lane BETWEEN 0 AND 63),
    pending_count bigint NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
    pending_bytes bigint NOT NULL DEFAULT 0 CHECK (pending_bytes >= 0)
);
INSERT INTO integration.outbox_budgets(lane) SELECT generate_series(0, 63);

CREATE TABLE integration.aggregate_revisions (
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    revision bigint NOT NULL,
    PRIMARY KEY (aggregate_type, aggregate_id)
);

CREATE TABLE integration.outbox (
    id uuid PRIMARY KEY,
    lane smallint NOT NULL REFERENCES integration.outbox_budgets(lane),
    charged_bytes integer NOT NULL CHECK (charged_bytes > 0),
    routing_key text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'IN_FLIGHT', 'DEAD')),
    created_at timestamptz NOT NULL DEFAULT now(),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    claim_token uuid,
    lease_owner uuid,
    lease_until timestamptz,
    last_error text
);
CREATE INDEX outbox_dispatch ON integration.outbox(next_attempt_at, created_at)
    WHERE status IN ('QUEUED', 'IN_FLIGHT');
CREATE INDEX outbox_dead ON integration.outbox(created_at) WHERE status = 'DEAD';
