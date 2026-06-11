package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotBlank;

public record JoinSessionRequest(@NotBlank String joinCode) {}
