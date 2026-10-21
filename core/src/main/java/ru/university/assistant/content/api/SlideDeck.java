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
        Instant createdAt,
        String thumbnailUrl) {
    public SlideDeck(UUID id, UUID courseId, String title, int version, int slideCount,
            boolean archived, String sourceFilename, Instant createdAt) {
        this(id, courseId, title, version, slideCount, archived, sourceFilename, createdAt, null);
    }
}
