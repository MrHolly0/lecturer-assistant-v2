package ru.university.assistant.live.api;

import jakarta.validation.constraints.Min;

public record ChangeSlideRequest(@Min(1) int slideIdx) {}
