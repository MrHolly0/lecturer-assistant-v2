package ru.university.assistant.interaction.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record StartBankPollRequest(@NotNull UUID questionId) {}
