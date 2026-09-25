package ru.university.assistant.qa.api;

import java.time.Instant;
import java.util.UUID;

public record StudentQuestion(
        UUID id,
        UUID sessionId,
        String displayName,
        String channelType,
        String text,
        QuestionStatus status,
        Instant createdAt,
        String answerText,
        Instant answeredAt,
        QuestionAnswerVisibility answerVisibility) {}
