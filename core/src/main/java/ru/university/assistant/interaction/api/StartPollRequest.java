package ru.university.assistant.interaction.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

public record StartPollRequest(
        @NotBlank String questionText,
        @NotEmpty @Size(min = 2, max = 6) List<@NotBlank String> options) {}
