package ru.university.assistant.interaction.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record QuickPoll(
        UUID id,
        UUID sessionId,
        UUID sourceQuestionId,
        String questionText,
        List<String> options,
        PollStatus status,
        Integer correctOptionIdx,
        Instant createdAt,
        Instant closedAt,
        QuestionType questionType) {
    public QuickPoll(
            UUID id,
            UUID sessionId,
            UUID sourceQuestionId,
            String questionText,
            List<String> options,
            PollStatus status,
            Integer correctOptionIdx,
            Instant createdAt,
            Instant closedAt) {
        this(id,
                sessionId, sourceQuestionId, questionText, options, status, correctOptionIdx, createdAt,
                closedAt, QuestionType.CHOICE);
    }
}
