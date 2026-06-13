package ru.university.assistant.interaction.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ActivityRun(
        UUID id,
        UUID definitionId,
        UUID sessionId,
        ActivityRunStatus status,
        List<UUID> questionIds,
        Instant startedAt,
        Instant closedAt) {}
