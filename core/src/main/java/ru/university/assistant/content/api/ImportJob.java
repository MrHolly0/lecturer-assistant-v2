package ru.university.assistant.content.api;

import java.time.Instant;
import java.util.UUID;

public record ImportJob(
        UUID id,
        UUID courseId,
        UUID deckId,
        ImportJobStatus status,
        int progressPercent,
        String sourceFilename,
        String errorMessage,
        Instant createdAt,
        Instant updatedAt) {}
