CREATE TABLE qa.author_mutes (
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    muted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, person_id)
);

-- Restricted audit data, never included in lecturer/student question DTOs or public events.
-- Preserve the original records when clearing a disruptive author's questions.
CREATE TABLE qa.author_moderation_log (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES qa.questions(id) ON DELETE CASCADE,
    actor_person_id uuid REFERENCES iam.persons(id) ON DELETE SET NULL,
    muted boolean NOT NULL,
    hidden_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX author_moderation_session ON qa.author_moderation_log(session_id, created_at);
