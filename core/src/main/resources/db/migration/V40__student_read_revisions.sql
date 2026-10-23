-- Read-side revisions cover every database writer, including imports and other core instances.
-- Lanes keep independent feedback submissions from taking the same revision row lock.
ALTER TABLE content.slide_decks ADD COLUMN read_revision bigint NOT NULL DEFAULT 0;
CREATE FUNCTION content.touch_student_deck_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE content.slide_decks SET read_revision = read_revision + 1 WHERE id = OLD.deck_id;
        RETURN OLD;
    END IF;
    UPDATE content.slide_decks SET read_revision = read_revision + 1 WHERE id = NEW.deck_id;
    IF TG_OP = 'UPDATE' AND OLD.deck_id <> NEW.deck_id THEN
        UPDATE content.slide_decks SET read_revision = read_revision + 1 WHERE id = OLD.deck_id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER student_deck_revision AFTER INSERT OR UPDATE OR DELETE ON content.slides
    FOR EACH ROW EXECUTE FUNCTION content.touch_student_deck_revision();

CREATE TABLE live.student_snapshot_revisions (
    session_id uuid NOT NULL REFERENCES live.sessions(id) ON DELETE CASCADE,
    lane smallint NOT NULL CHECK (lane BETWEEN 0 AND 15),
    revision bigint NOT NULL DEFAULT 1,
    PRIMARY KEY (session_id, lane)
);
CREATE FUNCTION live.touch_student_snapshot_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    source jsonb;
    target_session uuid;
    target_lane smallint;
BEGIN
    source := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    target_session := (source ->> 'session_id')::uuid;
    target_lane := (hashtextextended(coalesce(source ->> 'person_id', source ->> 'id'), 0) & 15)::smallint;
    IF EXISTS (SELECT 1 FROM live.sessions WHERE id = target_session) THEN
        INSERT INTO live.student_snapshot_revisions(session_id, lane, revision)
        VALUES (target_session, target_lane, 1)
        ON CONFLICT (session_id, lane) DO UPDATE
            SET revision = live.student_snapshot_revisions.revision + 1;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.session_id <> NEW.session_id
            AND EXISTS (SELECT 1 FROM live.sessions WHERE id = OLD.session_id) THEN
        INSERT INTO live.student_snapshot_revisions(session_id, lane, revision)
        VALUES (OLD.session_id, target_lane, 1)
        ON CONFLICT (session_id, lane) DO UPDATE
            SET revision = live.student_snapshot_revisions.revision + 1;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER student_snapshot_revision AFTER INSERT OR UPDATE OR DELETE ON feedback.comprehension_signals
    FOR EACH ROW EXECUTE FUNCTION live.touch_student_snapshot_revision();
CREATE TRIGGER student_snapshot_revision AFTER INSERT OR UPDATE OR DELETE ON qa.questions
    FOR EACH ROW EXECUTE FUNCTION live.touch_student_snapshot_revision();
CREATE TRIGGER student_snapshot_revision AFTER INSERT OR UPDATE OR DELETE ON interaction.quick_polls
    FOR EACH ROW EXECUTE FUNCTION live.touch_student_snapshot_revision();

-- Votes normally do not change the public OPEN poll, but may race with closing it.
CREATE FUNCTION live.touch_student_poll_response_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    source jsonb;
    target_session uuid;
    target_lane smallint;
BEGIN
    source := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    SELECT session_id INTO target_session FROM interaction.quick_polls WHERE id = (source ->> 'poll_id')::uuid;
    target_lane := (hashtextextended(source ->> 'person_id', 0) & 15)::smallint;
    IF target_session IS NOT NULL AND EXISTS (SELECT 1 FROM live.sessions WHERE id = target_session) THEN
        INSERT INTO live.student_snapshot_revisions(session_id, lane, revision)
        VALUES (target_session, target_lane, 1)
        ON CONFLICT (session_id, lane) DO UPDATE
            SET revision = live.student_snapshot_revisions.revision + 1;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER student_snapshot_revision AFTER INSERT OR UPDATE OR DELETE ON interaction.poll_responses
    FOR EACH ROW EXECUTE FUNCTION live.touch_student_poll_response_revision();
