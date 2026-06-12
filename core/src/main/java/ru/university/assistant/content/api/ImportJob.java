package ru.university.assistant.content.api;

import java.time.Instant;
import java.util.UUID;

public record ImportJob(
        UUID id,
        UUID courseId,
        UUID deckId,
        ImportJobStatus status,
        int progressPercent,
        String phase,
        int processedSlides,
        Integer totalSlides,
        String sourceFilename,
        String errorMessage,
        String warningMessage,
        Instant createdAt,
        Instant updatedAt) {}
