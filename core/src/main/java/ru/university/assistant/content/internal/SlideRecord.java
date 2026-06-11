package ru.university.assistant.content.internal;

import java.util.UUID;

record SlideRecord(UUID id, UUID deckId, int index, String imageRef, String textExtract) {}
