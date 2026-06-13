-- ===== B1: Quick-polls =====
CREATE TABLE interaction.quick_polls (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES live.sessions (id),
    question_text TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]',   -- ["Да", "Нет", ...]
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    correct_option_idx INTEGER,
    created_by UUID NOT NULL REFERENCES iam.persons (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE interaction.poll_responses (
    id UUID PRIMARY KEY,
    poll_id UUID NOT NULL REFERENCES interaction.quick_polls (id),
    person_id UUID NOT NULL REFERENCES iam.persons (id),
    option_idx INTEGER NOT NULL,
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_poll_response UNIQUE (poll_id, person_id)
);

-- ===== B2: Question bank =====
CREATE TABLE interaction.question_bank (
    id UUID PRIMARY KEY,
    course_id UUID NOT NULL REFERENCES org.courses (id),
    text TEXT NOT NULL,
    question_type VARCHAR(32) NOT NULL DEFAULT 'CHOICE',
    options JSONB NOT NULL DEFAULT '[]',   -- [{"text":"...","correct":true}, ...]
    tags TEXT[] NOT NULL DEFAULT '{}',
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES iam.persons (id)
);

CREATE INDEX idx_question_bank_course ON interaction.question_bank (course_id);

-- ===== B4: Activity engine =====
CREATE TABLE interaction.activity_definitions (
    id UUID PRIMARY KEY,
    course_id UUID NOT NULL REFERENCES org.courses (id),
    title TEXT NOT NULL,
    question_ids UUID[] NOT NULL DEFAULT '{}',
    strategy VARCHAR(32) NOT NULL DEFAULT 'ALL',
    strategy_n INTEGER,
    audience VARCHAR(32) NOT NULL DEFAULT 'ALL',
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES iam.persons (id)
);

CREATE TABLE interaction.activity_runs (
    id UUID PRIMARY KEY,
    definition_id UUID NOT NULL REFERENCES interaction.activity_definitions (id),
    session_id UUID NOT NULL REFERENCES live.sessions (id),
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    question_ids UUID[] NOT NULL DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE interaction.activity_responses (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES interaction.activity_runs (id),
    person_id UUID NOT NULL REFERENCES iam.persons (id),
    question_id UUID NOT NULL REFERENCES interaction.question_bank (id),
    answer JSONB NOT NULL,
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_activity_response UNIQUE (run_id, person_id, question_id)
);
