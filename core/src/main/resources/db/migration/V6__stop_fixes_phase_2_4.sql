ALTER TABLE content.slide_decks
    ADD COLUMN archived boolean NOT NULL DEFAULT false;

CREATE INDEX idx_slide_decks_course_active
    ON content.slide_decks(course_id, archived, created_at DESC);
