ALTER TABLE live.sessions ADD COLUMN presenter_seen_at timestamptz;

-- Existing sessions become monitored after a presenter reconnects. A deployment
-- must not treat the lack of historical presence records as an absent teacher.
CREATE INDEX idx_sessions_absent_presenter ON live.sessions (presenter_seen_at, id)
    WHERE status IN ('LIVE', 'PAUSED') AND presenter_seen_at IS NOT NULL;
