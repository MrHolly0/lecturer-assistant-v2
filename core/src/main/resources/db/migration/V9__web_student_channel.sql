CREATE TABLE live.web_participant_tokens (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    identity_level text NOT NULL CHECK (identity_level IN ('EPHEMERAL', 'PROFILE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_web_participant_tokens_session
    ON live.web_participant_tokens(session_id, created_at DESC);

CREATE TABLE feedback.comprehension_signals (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    channel_type text NOT NULL CHECK (channel_type IN ('web', 'telegram', 'vk', 'echo')),
    value text NOT NULL CHECK (value IN ('GREEN', 'YELLOW', 'RED')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comprehension_signals_session_time
    ON feedback.comprehension_signals(session_id, created_at DESC);

CREATE TABLE qa.questions (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    person_id uuid REFERENCES iam.persons(id) ON DELETE SET NULL,
    display_name text NOT NULL,
    channel_type text NOT NULL CHECK (channel_type IN ('web', 'telegram', 'vk', 'echo')),
    text text NOT NULL,
    status text NOT NULL CHECK (status IN ('OPEN', 'ANSWERED', 'DISMISSED')),
    answer_text text,
    created_at timestamptz NOT NULL DEFAULT now(),
    answered_at timestamptz
);

CREATE INDEX idx_questions_session_status_time
    ON qa.questions(session_id, status, created_at DESC);
