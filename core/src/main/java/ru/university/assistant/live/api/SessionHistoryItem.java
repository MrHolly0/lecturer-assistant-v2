package ru.university.assistant.live.api;

import java.time.Instant;
import java.util.UUID;

public record SessionHistoryItem(
        UUID id,
        UUID lectureId,
        String lectureTitle,
        SessionStatus status,
        Instant startedAt,
        Instant endedAt) {}
