package ru.university.assistant.analytics.api;

import java.util.UUID;

public interface EventBus {
    UUID publish(DomainEvent event);
}
