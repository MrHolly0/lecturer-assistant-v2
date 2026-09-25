ALTER TABLE interaction.quick_polls
    ADD COLUMN source_question_id UUID REFERENCES interaction.question_bank (id) ON DELETE SET NULL;

CREATE INDEX idx_quick_polls_session_created
    ON interaction.quick_polls (session_id, created_at);

CREATE INDEX idx_quick_polls_source_question
    ON interaction.quick_polls (source_question_id)
    WHERE source_question_id IS NOT NULL;
