package ru.university.assistant.channel.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.util.UUID;

public record DeliveryReport(
        @NotNull UUID messageId,
        @NotNull DeliveryStatus status,
        String adapterMessageId,
        String errorMessage,
        Integer latencyMs,
        @NotNull UUID attemptToken,
        @PositiveOrZero Long retryAfterMs) {
    public DeliveryReport(
            UUID messageId, DeliveryStatus status, String adapterMessageId,
            String errorMessage, Integer latencyMs, UUID attemptToken) {
        this(messageId, status, adapterMessageId, errorMessage, latencyMs, attemptToken, null);
    }
    public DeliveryReport(
            UUID messageId,
            DeliveryStatus status,
            String adapterMessageId,
            String errorMessage,
            Integer latencyMs) {
        this(messageId, status, adapterMessageId, errorMessage, latencyMs, null, null);
    }
}
