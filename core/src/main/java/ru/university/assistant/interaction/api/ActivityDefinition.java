package ru.university.assistant.interaction.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ActivityDefinition(
        UUID id,
        UUID courseId,
        String title,
        List<UUID> questionIds,
        ActivityStrategy strategy,
        Integer strategyN,
        boolean archived,
        Instant createdAt) {}
