package ru.university.assistant.interaction.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record QuickPoll(
        UUID id,
        UUID sessionId,
        String questionText,
        List<String> options,
        PollStatus status,
        Integer correctOptionIdx,
        Instant createdAt,
        Instant closedAt) {}
