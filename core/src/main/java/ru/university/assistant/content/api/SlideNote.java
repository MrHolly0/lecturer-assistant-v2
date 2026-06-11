package ru.university.assistant.content.api;

import java.time.Instant;
import java.util.UUID;

public record SlideNote(UUID slideId, String content, Instant updatedAt) {}
