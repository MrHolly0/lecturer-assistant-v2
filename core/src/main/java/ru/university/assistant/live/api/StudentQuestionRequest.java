package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record StudentQuestionRequest(
        String participantToken,
        @NotBlank @Size(min = 2, max = 2000) String text) {}
