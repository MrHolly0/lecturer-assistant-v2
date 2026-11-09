CREATE TABLE IF NOT EXISTS inbox (
    event_id uuid PRIMARY KEY,
    received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_retention ON inbox(received_at);
CREATE TABLE IF NOT EXISTS report_jobs (
    session_id uuid PRIMARY KEY,
    generation bigint NOT NULL DEFAULT 1,
    claim_token uuid,
    lease_until timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    dead boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS report_jobs_due ON report_jobs(next_attempt_at) WHERE NOT dead;
CREATE TABLE IF NOT EXISTS reports (
    session_id uuid PRIMARY KEY,
    fingerprint varchar(64) NOT NULL,
    payload jsonb NOT NULL,
    prepared_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rejected_events (
    digest varchar(64) PRIMARY KEY,
    received_at timestamptz NOT NULL DEFAULT now(),
    reason varchar(120) NOT NULL
);
