package ru.university.assistant.analytics.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.shared.api.UuidV7;
import ru.university.assistant.integration.api.IntegrationEvents;

@Component
class JdbcEventBus implements EventBus {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final IntegrationEvents integration;

    JdbcEventBus(JdbcClient jdbc, ObjectMapper objectMapper, IntegrationEvents integration) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.integration = integration;
    }

    @Override
    @org.springframework.transaction.annotation.Transactional
    public UUID publish(DomainEvent event) {
        UUID eventId = UuidV7.generate();
        jdbc.sql(
                        """
                        insert into analytics.events (id, aggregate_type, aggregate_id, verb, actor_person_id,
                            context, payload)
                        values (:id, :aggregateType, :aggregateId, :verb, :actorPersonId,
                            cast(:context as jsonb), cast(:payload as jsonb))
                        """)
                .param("id", eventId)
                .param("aggregateType", event.aggregateType())
                .param("aggregateId", event.aggregateId())
                .param("verb", event.verb())
                .param("actorPersonId", event.actorPersonId())
                .param("context", json(event.context()))
                .param("payload", json(event.payload()))
                .update();
        if (!integration.enabled()) return eventId;
        Object session = event.context() == null ? null : event.context().get("sessionId");
        UUID sessionId = session == null ? null : UUID.fromString(session.toString());
        Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("verb", event.verb());
        data.put("actorPersonId", event.actorPersonId());
        data.put("context", event.context());
        data.put("payload", event.payload());
        integration.append(eventId, "domain", event.verb(), event.aggregateType(),
                event.aggregateId(), sessionId, data);
        return eventId;
    }

    private String json(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Cannot serialize event JSON", exception);
        }
    }
}
