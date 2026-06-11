package ru.university.assistant.content.api;

import java.util.UUID;

public record Slide(UUID id, UUID deckId, int idx, String imageUrl, String textExtract, SlideNote note) {}
