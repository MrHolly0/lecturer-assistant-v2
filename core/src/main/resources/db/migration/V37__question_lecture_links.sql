ALTER TABLE interaction.question_bank ADD CONSTRAINT uq_question_bank_course UNIQUE (course_id, id);
ALTER TABLE live.lectures ADD CONSTRAINT uq_lecture_course UNIQUE (course_id, id);

CREATE TABLE interaction.question_lectures (
    course_id uuid NOT NULL,
    question_id uuid NOT NULL,
    lecture_id uuid NOT NULL,
    PRIMARY KEY (question_id, lecture_id),
    FOREIGN KEY (course_id, question_id) REFERENCES interaction.question_bank(course_id, id) ON DELETE CASCADE,
    FOREIGN KEY (course_id, lecture_id) REFERENCES live.lectures(course_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_question_lectures_course_lecture ON interaction.question_lectures(course_id, lecture_id);
