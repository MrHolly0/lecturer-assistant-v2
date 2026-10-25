package ru.university.assistant.content.api;

import java.util.UUID;

public interface StudentDeckApi {
    SlideDeckDetails getDeckForStudent(UUID courseId, UUID deckId);
    boolean containsSlide(UUID courseId, UUID deckId, int slideIdx);
    String slideImageUrlForDelivery(UUID courseId, UUID deckId, int slideIdx);
}
