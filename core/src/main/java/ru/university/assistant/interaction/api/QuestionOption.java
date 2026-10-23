package ru.university.assistant.interaction.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record QuestionOption(@NotBlank @Size(max = 4000) String text, boolean correct) {}
