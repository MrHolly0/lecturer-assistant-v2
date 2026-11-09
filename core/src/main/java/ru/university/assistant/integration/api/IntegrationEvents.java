package ru.university.assistant.integration.api;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.shared.api.UuidV7;

/** Durable delivery intent joins the caller's transaction; the broker is never called here. */
@Service
public class IntegrationEvents {
    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final boolean enabled;
    private final long bytesPerLane;
    private final long countPerLane;

    public IntegrationEvents(JdbcClient jdbc, ObjectMapper json,
            @Value("${app.integration.enabled:false}") boolean enabled,
            @Value("${app.integration.max-pending-bytes:268435456}") long maxBytes,
            @Value("${app.integration.max-pending-count:50000}") long maxCount) {
        this.jdbc = jdbc;
        this.json = json;
        this.enabled = enabled;
        if (maxBytes < 64 || maxCount < 64) throw new IllegalArgumentException("Invalid outbox budget");
        bytesPerLane = maxBytes / 64;
        countPerLane = maxCount / 64;
    }

    public boolean enabled() { return enabled; }

    @Transactional
    public void append(UUID eventId, String stream, String type, String aggregateType, UUID aggregateId,
            UUID sessionId, Map<String, Object> data) {
        if (!enabled) return;
        long revision = jdbc.sql("""
                insert into integration.aggregate_revisions(aggregate_type, aggregate_id, revision)
                values (:type, :id, 1) on conflict (aggregate_type, aggregate_id)
                do update set revision = integration.aggregate_revisions.revision + 1 returning revision
                """).param("type", aggregateType).param("id", aggregateId).query(Long.class).single();
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("eventId", eventId);
        envelope.put("type", type);
        envelope.put("schemaVersion", 1);
        envelope.put("aggregate", Map.of("type", aggregateType, "id", aggregateId, "revision", revision));
        envelope.put("sessionId", sessionId);
        envelope.put("occurredAt", Instant.now());
        envelope.put("audience", "INTERNAL");
        envelope.put("data", data);
        String payload;
        try { payload = json.writeValueAsString(envelope); }
        catch (JsonProcessingException exception) { throw new IllegalArgumentException("Invalid event", exception); }
        int bytes = payload.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > 64 * 1024) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Integration event exceeds 64 KiB");
        }
        int preferredLane = (int) (eventId.getLeastSignificantBits() & 63);
        int charge = bytes + 512;
        var reserved = jdbc.sql("""
                with available as (
                    select lane from integration.outbox_budgets
                    where pending_count < :count and pending_bytes + :bytes <= :maxBytes
                    order by (lane - :preferred + 64) % 64 for update skip locked limit 1
                ) update integration.outbox_budgets b set pending_count = pending_count + 1,
                    pending_bytes = pending_bytes + :bytes from available a where b.lane = a.lane returning b.lane
                """).param("bytes", charge).param("preferred", preferredLane).param("count", countPerLane)
                .param("maxBytes", bytesPerLane).query(Integer.class).optional();
        if (reserved.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Event delivery backlog is full");
        }
        jdbc.sql("""
                insert into integration.outbox(id, lane, charged_bytes, routing_key, payload)
                values (:id, :lane, :bytes, :key, cast(:payload as jsonb))
                """).param("id", eventId).param("lane", reserved.get()).param("bytes", charge)
                .param("key", stream + "." + type.replaceAll("[^a-zA-Z0-9_.-]", "_"))
                .param("payload", payload).update();
    }

    @Transactional
    public void sessionChanged(String type, UUID sessionId) {
        append(UuidV7.generate(), "realtime", type, "session", sessionId, sessionId, Map.of());
    }
}
