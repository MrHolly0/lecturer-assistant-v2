package ru.university.assistant.content.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public record CreateLectureRequest(
        @NotBlank @Size(max = 255) String title,
        @NotNull UUID deckId) {}
