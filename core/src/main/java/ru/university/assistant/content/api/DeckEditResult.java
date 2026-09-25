package ru.university.assistant.content.api;

import java.util.UUID;

public record DeckEditResult(
        SlideDeckDetails deck,
        boolean copyOnWrite,
        UUID sourceDeckId) {}
