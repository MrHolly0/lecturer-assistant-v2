package ru.university.assistant.interaction.api;

import jakarta.validation.constraints.NotBlank;

public record QuestionOption(@NotBlank String text, boolean correct) {}
