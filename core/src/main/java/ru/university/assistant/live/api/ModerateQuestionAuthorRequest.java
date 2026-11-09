package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotNull;

public record ModerateQuestionAuthorRequest(@NotNull Boolean muted, boolean hideQuestions) {}
