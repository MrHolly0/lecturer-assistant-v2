ALTER TABLE qa.questions
    ADD COLUMN answer_visibility text;

-- Старые ответы считаем личными: это консервативный вариант, не расширяющий аудиторию.
UPDATE qa.questions
SET answer_visibility = 'AUTHOR'
WHERE status = 'ANSWERED';

ALTER TABLE qa.questions
    ADD CONSTRAINT chk_question_answer_visibility
        CHECK (answer_visibility IS NULL OR answer_visibility IN ('AUTHOR', 'SESSION')),
    ADD CONSTRAINT chk_question_answer_visibility_status
        CHECK ((status = 'ANSWERED' AND answer_visibility IS NOT NULL)
            OR (status <> 'ANSWERED' AND answer_visibility IS NULL));

CREATE INDEX idx_questions_session_answer_visibility
    ON qa.questions(session_id, answer_visibility, answered_at DESC)
    WHERE status = 'ANSWERED';
