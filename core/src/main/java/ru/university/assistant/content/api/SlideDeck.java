package ru.university.assistant.content.api;

import java.time.Instant;
import java.util.UUID;

public record SlideDeck(
        UUID id,
        UUID courseId,
        String title,
        int version,
        int slideCount,
        boolean archived,
        String sourceFilename,
        Instant createdAt) {}
