package ru.university.assistant.interaction.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;

public record CreateActivityRequest(
        @NotBlank String title,
        @NotNull List<UUID> questionIds,
        @NotNull ActivityStrategy strategy,
        Integer strategyN) {}
