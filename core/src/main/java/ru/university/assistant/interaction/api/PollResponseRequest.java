package ru.university.assistant.interaction.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record PollResponseRequest(
        String participantToken,
        @NotNull @Min(0) Integer optionIdx) {}
