package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record StudentNameRequest(
        String participantToken,
        @NotBlank @Size(min = 2, max = 80) String lastName,
        @NotBlank @Size(min = 2, max = 80) String firstName) {}
