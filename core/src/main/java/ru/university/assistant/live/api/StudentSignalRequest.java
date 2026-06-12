package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import ru.university.assistant.feedback.api.SignalValue;

public record StudentSignalRequest(@NotBlank String participantToken, @NotNull SignalValue value) {}
