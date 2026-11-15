CREATE SCHEMA installation;
CREATE TABLE installation.state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    catalog_payload text,
    catalog_signature text,
    catalog_synced_at timestamptz,
    operator_seen_at timestamptz,
    operator_kind varchar(16)
);
INSERT INTO installation.state(singleton) VALUES (true);
CREATE TABLE installation.jobs (
    id uuid PRIMARY KEY,
    release_id varchar(80) NOT NULL,
    requested_by uuid REFERENCES iam.persons(id) ON DELETE SET NULL,
    idempotency_key varchar(80) NOT NULL UNIQUE,
    catalog_payload text NOT NULL,
    catalog_signature text NOT NULL,
    owner uuid,
    fence bigint NOT NULL DEFAULT 0,
    lease_until timestamptz,
    maintenance_until timestamptz,
    status varchar(24) NOT NULL DEFAULT 'QUEUED',
    stage varchar(32) NOT NULL DEFAULT 'QUEUED',
    summary varchar(500) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ix_installation_one_active ON installation.jobs ((true))
    WHERE status IN ('QUEUED','RUNNING','NEEDS_ATTENTION');
CREATE TABLE installation.audit (
    id bigserial PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES installation.jobs(id),
    stage varchar(32) NOT NULL,
    summary varchar(500) NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now()
);
