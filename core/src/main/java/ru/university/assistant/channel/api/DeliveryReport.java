package ru.university.assistant.channel.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record DeliveryReport(
        @NotNull UUID messageId,
        @NotNull DeliveryStatus status,
        String adapterMessageId,
        String errorMessage,
        Integer latencyMs,
        @NotNull UUID attemptToken) {
    public DeliveryReport(
            UUID messageId,
            DeliveryStatus status,
            String adapterMessageId,
            String errorMessage,
            Integer latencyMs) {
        this(messageId, status, adapterMessageId, errorMessage, latencyMs, null);
    }
}
