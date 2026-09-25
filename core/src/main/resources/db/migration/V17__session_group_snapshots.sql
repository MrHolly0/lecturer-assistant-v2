CREATE TABLE live.session_groups (
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES org.study_groups(id) ON DELETE RESTRICT,
    group_name_snapshot text NOT NULL CHECK (length(btrim(group_name_snapshot)) > 0),
    PRIMARY KEY (session_id, group_id)
);

ALTER TABLE live.session_participants
    ADD COLUMN group_id uuid REFERENCES org.study_groups(id) ON DELETE RESTRICT,
    ADD COLUMN group_name_snapshot text;

ALTER TABLE live.session_participants
    ADD CONSTRAINT session_participants_group_snapshot_check
    CHECK (
        (group_id IS NULL AND group_name_snapshot IS NULL)
        OR (group_id IS NOT NULL AND length(btrim(group_name_snapshot)) > 0)
    );

CREATE INDEX idx_session_groups_group_session ON live.session_groups(group_id, session_id);
CREATE INDEX idx_session_participants_group_session
    ON live.session_participants(group_id, session_id)
    WHERE group_id IS NOT NULL;
