CREATE TABLE qa.history_revisions (
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    person_id uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    PRIMARY KEY(session_id,person_id)
);
-- Preserve authored history on upgrades: revision zero means that this person has no history.
INSERT INTO qa.history_revisions(session_id,person_id,revision)
SELECT session_id,person_id,count(*) FROM qa.questions WHERE person_id IS NOT NULL GROUP BY session_id,person_id;
INSERT INTO qa.history_revisions(session_id,person_id,revision)
SELECT session_id,'00000000-0000-0000-0000-000000000000',count(*) FROM qa.questions
WHERE status='ANSWERED' AND answer_visibility='SESSION' GROUP BY session_id;
CREATE FUNCTION qa.touch_history_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item qa.questions; target uuid;
BEGIN
    item := CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
    IF EXISTS(SELECT 1 FROM live.sessions WHERE id=item.session_id) THEN
        IF item.person_id IS NOT NULL THEN
        INSERT INTO qa.history_revisions(session_id,person_id) VALUES(item.session_id,item.person_id)
        ON CONFLICT(session_id,person_id) DO UPDATE SET revision=qa.history_revisions.revision+1;
        END IF;
        IF TG_OP='UPDATE' AND OLD.person_id IS NOT NULL AND OLD.person_id IS DISTINCT FROM NEW.person_id THEN
            INSERT INTO qa.history_revisions(session_id,person_id) VALUES(item.session_id,OLD.person_id)
            ON CONFLICT(session_id,person_id) DO UPDATE SET revision=qa.history_revisions.revision+1;
        END IF;
        IF (TG_OP <> 'INSERT' AND OLD.status='ANSWERED' AND OLD.answer_visibility='SESSION')
            OR (TG_OP <> 'DELETE' AND NEW.status='ANSWERED' AND NEW.answer_visibility='SESSION') THEN
            INSERT INTO qa.history_revisions(session_id,person_id) VALUES(item.session_id,'00000000-0000-0000-0000-000000000000')
            ON CONFLICT(session_id,person_id) DO UPDATE SET revision=qa.history_revisions.revision+1;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER question_history_revision AFTER INSERT OR UPDATE OR DELETE ON qa.questions
FOR EACH ROW EXECUTE FUNCTION qa.touch_history_revision();
CREATE INDEX question_history_answered ON qa.questions(session_id,answered_at DESC,id DESC)
WHERE status='ANSWERED' AND answer_text IS NOT NULL;
CREATE INDEX question_history_person ON qa.questions(session_id,person_id,created_at DESC,id DESC);
