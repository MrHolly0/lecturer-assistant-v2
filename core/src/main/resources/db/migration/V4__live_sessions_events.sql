CREATE TABLE analytics.events (
    id uuid PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    verb text NOT NULL,
    actor_person_id uuid REFERENCES iam.persons(id),
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics.outbox (
    id uuid PRIMARY KEY,
    event_id uuid NOT NULL REFERENCES analytics.events(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE live.sessions (
    id uuid PRIMARY KEY,
    lecture_id uuid NOT NULL REFERENCES live.lectures(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('SCHEDULED', 'LIVE', 'PAUSED', 'ENDED', 'ARCHIVED')),
    join_code text NOT NULL UNIQUE,
    current_slide_idx integer NOT NULL DEFAULT 1 CHECK (current_slide_idx >= 1),
    annotations jsonb NOT NULL DEFAULT '{}'::jsonb,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_at timestamptz,
    ended_at timestamptz,
    created_by uuid NOT NULL REFERENCES iam.persons(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE live.session_participants (
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    person_id uuid REFERENCES iam.persons(id) ON DELETE SET NULL,
    channel_type text NOT NULL CHECK (channel_type IN ('web', 'telegram', 'vk')),
    display_name text NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    kicked boolean NOT NULL DEFAULT false,
    PRIMARY KEY (session_id, person_id, channel_type)
);

CREATE TABLE live.slide_log (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    slide_idx integer NOT NULL CHECK (slide_idx >= 1),
    entered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_aggregate ON analytics.events(aggregate_type, aggregate_id, occurred_at);
CREATE INDEX idx_events_verb ON analytics.events(verb, occurred_at);
CREATE INDEX idx_outbox_status ON analytics.outbox(status, next_attempt_at);
CREATE INDEX idx_sessions_lecture ON live.sessions(lecture_id, created_at DESC);
CREATE INDEX idx_sessions_join_code ON live.sessions(join_code);
CREATE INDEX idx_session_participants_session ON live.session_participants(session_id, joined_at);
CREATE INDEX idx_slide_log_session ON live.slide_log(session_id, entered_at);
