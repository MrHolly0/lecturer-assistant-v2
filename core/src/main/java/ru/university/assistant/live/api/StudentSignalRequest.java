package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotNull;
import ru.university.assistant.feedback.api.SignalValue;

public record StudentSignalRequest(String participantToken, @NotNull SignalValue value) {}
