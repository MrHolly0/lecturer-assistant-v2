package ru.university.assistant.content.api;

import java.time.Instant;
import java.util.UUID;

public record Lecture(
        UUID id,
        UUID courseId,
        String title,
        UUID deckId,
        String deckTitle,
        int deckVersion,
        boolean archived,
        Instant createdAt) {}
