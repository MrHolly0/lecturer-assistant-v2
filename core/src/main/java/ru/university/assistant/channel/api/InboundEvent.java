package ru.university.assistant.channel.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;

public record InboundEvent(
        @NotBlank String externalUserId,
        @NotNull InboundKind kind,
        @NotBlank String text,
        String displayHint,
        @NotNull Instant occurredAt) {}
