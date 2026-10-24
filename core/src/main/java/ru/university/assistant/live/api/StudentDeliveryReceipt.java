package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record StudentDeliveryReceipt(@NotNull UUID sessionId, boolean completed, UUID personId) {}
