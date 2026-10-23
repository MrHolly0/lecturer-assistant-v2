-- Historical actor-independent result. Authorization is always evaluated before reading it.
CREATE TABLE analytics.lecture_summaries (
    session_id uuid PRIMARY KEY REFERENCES live.sessions(id) ON DELETE CASCADE,
    source_fingerprint text NOT NULL,
    schema_version integer NOT NULL,
    payload jsonb NOT NULL,
    prepared_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER student_snapshot_revision AFTER INSERT OR UPDATE OR DELETE ON live.session_participants
    FOR EACH ROW EXECUTE FUNCTION live.touch_student_snapshot_revision();
