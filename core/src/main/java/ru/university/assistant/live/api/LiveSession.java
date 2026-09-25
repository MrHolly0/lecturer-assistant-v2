package ru.university.assistant.live.api;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record LiveSession(
        UUID id,
        UUID courseId,
        UUID lectureId,
        UUID deckId,
        String lectureTitle,
        List<SessionGroup> groups,
        SessionStatus status,
        String joinCode,
        int currentSlideIdx,
        Map<String, Object> annotations,
        Instant startedAt,
        Instant endedAt,
        Instant timingCalculatedAt,
        long activeDurationSeconds,
        long currentSlideDurationSeconds) {}
