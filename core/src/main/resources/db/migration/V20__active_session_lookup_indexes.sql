CREATE INDEX idx_session_participants_active_person
    ON live.session_participants(person_id, joined_at DESC)
    INCLUDE (session_id)
    WHERE channel_type = 'web' AND left_at IS NULL AND kicked = false;

CREATE INDEX idx_sessions_active_creator
    ON live.sessions(created_by, created_at DESC)
    WHERE status IN ('SCHEDULED', 'LIVE', 'PAUSED');
