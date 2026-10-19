CREATE SCHEMA IF NOT EXISTS projection;

CREATE TABLE projection.policy (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    agent_allowed boolean NOT NULL DEFAULT false,
    minimum_version varchar(32) NOT NULL DEFAULT '0.1.0',
    revision bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES iam.persons(id) ON DELETE SET NULL
);
INSERT INTO projection.policy(singleton) VALUES (true);

CREATE TABLE projection.pairings (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    code_hash varchar(64) NOT NULL UNIQUE,
    policy_revision bigint NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);

CREATE TABLE projection.devices (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL UNIQUE,
    name varchar(80) NOT NULL,
    platform varchar(24) NOT NULL,
    version varchar(32) NOT NULL,
    os_version varchar(80) NOT NULL,
    protocol_version integer NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'IDLE',
    screens jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL,
    last_seen_at timestamptz,
    revoked_at timestamptz,
    active_course_id uuid REFERENCES org.courses(id) ON DELETE SET NULL,
    active_session_id uuid REFERENCES live.sessions(id) ON DELETE SET NULL,
    active_until timestamptz,
    active_command_id uuid,
    diagnostic_code varchar(64)
);
CREATE INDEX projection_devices_owner ON projection.devices(owner_id);

CREATE TABLE projection.commands (
    id uuid PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES projection.devices(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    type varchar(32) NOT NULL CHECK (type IN (
        'TEST_TARGET', 'START_PUBLIC_PROJECTION', 'STOP_PROJECTION', 'CHECK_UPDATE'
    )),
    course_id uuid REFERENCES org.courses(id) ON DELETE CASCADE,
    session_id uuid REFERENCES live.sessions(id) ON DELETE CASCADE,
    target_screen_id varchar(160),
    screen_fingerprint varchar(64),
    test_code varchar(6),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    acknowledged_at timestamptz,
    result varchar(16),
    UNIQUE(device_id, request_id)
);
CREATE INDEX projection_pending_commands ON projection.commands(device_id, created_at)
    WHERE acknowledged_at IS NULL;
