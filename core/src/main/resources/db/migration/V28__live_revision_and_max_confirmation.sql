ALTER TABLE live.sessions ADD COLUMN version bigint NOT NULL DEFAULT 0;
ALTER TABLE live.sessions ADD COLUMN show_join_code boolean NOT NULL DEFAULT false;
CREATE INDEX questions_session_author ON qa.questions(session_id, person_id, created_at);

CREATE TABLE iam.max_link_confirmations (
    token_hash text PRIMARY KEY,
    external_id text NOT NULL,
    target_person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    current_person_id uuid REFERENCES iam.persons(id) ON DELETE SET NULL,
    target_auth_version bigint NOT NULL,
    current_auth_version bigint,
    link_code text,
    display_hint text,
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);
CREATE INDEX max_link_confirmation_expiry ON iam.max_link_confirmations(expires_at);
