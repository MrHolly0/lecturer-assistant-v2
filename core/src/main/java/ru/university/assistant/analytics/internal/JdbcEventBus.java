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

@Component
class JdbcEventBus implements EventBus {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    JdbcEventBus(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    @Override
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
        jdbc.sql(
                        """
                        insert into analytics.outbox (id, event_id, status)
                        values (:id, :eventId, 'PENDING')
                        """)
                .param("id", UuidV7.generate())
                .param("eventId", eventId)
                .update();
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
