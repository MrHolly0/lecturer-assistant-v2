package ru.university.assistant.content.api;

import java.time.Instant;
import java.util.UUID;

public record SlideDeck(
        UUID id,
        UUID courseId,
        String title,
        int version,
        int slideCount,
        String sourceFilename,
        Instant createdAt) {}
