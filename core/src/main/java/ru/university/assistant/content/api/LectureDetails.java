package ru.university.assistant.content.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record LectureDetails(
        UUID id,
        UUID courseId,
        String title,
        UUID deckId,
        String deckTitle,
        int deckVersion,
        boolean archived,
        Instant createdAt,
        List<Attachment> attachments) {}
