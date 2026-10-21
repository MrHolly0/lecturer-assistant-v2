ALTER TABLE interaction.quick_polls
    ADD COLUMN question_type VARCHAR(32) NOT NULL DEFAULT 'CHOICE';

UPDATE interaction.quick_polls p
SET question_type = q.question_type
FROM interaction.question_bank q
WHERE p.source_question_id = q.id AND q.question_type IN ('CHOICE', 'TRUE_FALSE');

ALTER TABLE interaction.quick_polls
    ADD CONSTRAINT ck_quick_poll_question_type
    CHECK (question_type IN ('CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER'));

ALTER TABLE interaction.poll_responses
    ALTER COLUMN option_idx DROP NOT NULL,
    ADD COLUMN text_answer VARCHAR(2000),
    ADD CONSTRAINT ck_poll_response_answer
    CHECK ((option_idx IS NOT NULL AND text_answer IS NULL)
        OR (option_idx IS NULL AND text_answer IS NOT NULL AND length(trim(text_answer)) > 0));
