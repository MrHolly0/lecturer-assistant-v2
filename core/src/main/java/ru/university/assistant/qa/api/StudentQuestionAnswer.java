package ru.university.assistant.qa.api;

import java.time.Instant;
import java.util.UUID;

/** Безопасная student-модель ответа: личность автора вопроса намеренно отсутствует. */
public record StudentQuestionAnswer(
        UUID questionId,
        String questionText,
        String answerText,
        QuestionAnswerVisibility answerVisibility,
        Instant answeredAt) {}
