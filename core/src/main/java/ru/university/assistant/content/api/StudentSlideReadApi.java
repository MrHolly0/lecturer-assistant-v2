package ru.university.assistant.content.api;

import java.util.UUID;

public interface StudentSlideReadApi {
    StudentSlideView slide(UUID courseId, UUID deckId, int slideIndex);
}
