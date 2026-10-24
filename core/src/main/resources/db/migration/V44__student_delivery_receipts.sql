-- Passive attendance is separate from membership and moderation: a lost connection is not a kick.
CREATE TABLE live.student_delivery_receipts (
    session_id uuid NOT NULL,
    person_id uuid NOT NULL,
    channel_type text NOT NULL DEFAULT 'web' CHECK (channel_type = 'web'),
    last_seen_at timestamptz NOT NULL,
    completed_at timestamptz,
    PRIMARY KEY (session_id, person_id, channel_type),
    FOREIGN KEY (session_id, person_id, channel_type)
        REFERENCES live.session_participants(session_id, person_id, channel_type) ON DELETE CASCADE
);

-- Ordinary receipts never invalidate shared snapshots. Late completion receipts refresh the final report.
CREATE TRIGGER student_completion_revision AFTER UPDATE ON live.student_delivery_receipts
    FOR EACH ROW WHEN (OLD.completed_at IS DISTINCT FROM NEW.completed_at)
    EXECUTE FUNCTION live.touch_student_snapshot_revision();
