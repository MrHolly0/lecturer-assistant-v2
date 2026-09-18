package ru.university.assistant.interaction.api;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record SubmitActivityResponseRequest(
        String participantToken,
        @NotNull UUID questionId,
        @NotNull JsonNode answer) {}
