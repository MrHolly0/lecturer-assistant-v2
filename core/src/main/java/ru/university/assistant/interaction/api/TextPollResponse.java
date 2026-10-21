package ru.university.assistant.interaction.api;

import java.time.Instant;
import java.util.UUID;

public record TextPollResponse(UUID id, String text, Instant answeredAt) {}
