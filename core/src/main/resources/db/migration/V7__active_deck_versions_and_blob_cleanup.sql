ALTER TABLE content.slide_decks
    DROP CONSTRAINT slide_decks_course_id_title_version_key;

CREATE UNIQUE INDEX uq_slide_decks_active_title_version
    ON content.slide_decks(course_id, title, version)
    WHERE archived = false;
