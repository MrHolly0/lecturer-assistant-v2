ALTER TABLE live.session_participants
    ADD COLUMN voluntarily_left boolean NOT NULL DEFAULT false;

CREATE TABLE live.student_visit_events (
    id bigserial PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES iam.persons(id) ON DELETE CASCADE,
    event_type text NOT NULL CHECK (event_type IN ('LEFT', 'RETURNED')),
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_student_visit_events_person ON live.student_visit_events(person_id, occurred_at DESC);
