package ru.university.assistant.content.internal;

import java.util.UUID;

record DeckRecord(UUID id, UUID courseId, String title, int version) {}
