package ru.university.assistant.interaction.api;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

public record ActivityResponse(
        UUID id,
        UUID runId,
        UUID personId,
        UUID questionId,
        JsonNode answer,
        Instant answeredAt) {}
