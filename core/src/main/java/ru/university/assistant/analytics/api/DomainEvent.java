package ru.university.assistant.analytics.api;

import java.util.Map;
import java.util.UUID;

public record DomainEvent(
        String aggregateType,
        UUID aggregateId,
        String verb,
        UUID actorPersonId,
        Map<String, Object> context,
        Map<String, Object> payload) {}
