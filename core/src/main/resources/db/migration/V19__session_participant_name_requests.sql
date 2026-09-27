ALTER TABLE live.session_participants
    ADD COLUMN name_requested_at timestamptz,
    ADD COLUMN name_submitted_at timestamptz;
