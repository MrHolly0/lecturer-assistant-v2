package ru.university.assistant.content.api;

import java.time.Instant;
import java.util.UUID;

public record Attachment(
        UUID id,
        UUID lectureId,
        String filename,
        String contentType,
        long sizeBytes,
        Instant createdAt) {}
