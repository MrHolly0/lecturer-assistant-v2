package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import ru.university.assistant.integration.api.IntegrationEvents;

@TestPropertySource(properties = {
    "app.integration.enabled=true", "app.integration.max-attempts=2",
    "app.live.legacy-transports-enabled=false",
    "app.services.events-key=events-test-credential-0000000000000000",
    "app.services.realtime-key=realtime-test-credential-00000000000000"
})
class IntegrationServicesTest extends LiveFlowTestBase {
    private static final String EVENTS = "events-test-credential-0000000000000000";
    private static final String REALTIME = "realtime-test-credential-00000000000000";
    @Autowired IntegrationEvents integration;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @Autowired @org.springframework.beans.factory.annotation.Qualifier("applicationDataSource")
    com.zaxxer.hikari.HikariDataSource applicationPool;

    @BeforeEach
    @org.junit.jupiter.api.AfterEach
    void clearIntegration() {
        jdbc.sql("truncate integration.outbox, integration.aggregate_revisions").update();
        jdbc.sql("update integration.outbox_budgets set pending_count = 0, pending_bytes = 0").update();
    }

    @Test
    void rolledBackBusinessCommandLeavesNoEventOrBudgetReservation() {
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(transactions).execute(s -> {
            integration.sessionChanged("session.changed", sessionId);
            throw new IllegalStateException("rollback");
        }));
        assertEquals(0L, count("integration.outbox"));
        assertEquals(0L, count("integration.aggregate_revisions"));
        assertEquals(0L, jdbc.sql("select sum(pending_count) from integration.outbox_budgets")
                .query(Long.class).single());
    }

    @Test
    void permissionRenewalDoesNotWaitForAnExhaustedApplicationPool() throws Exception {
        JsonNode participant = join(null, "{\"displayName\":\"Pool isolation\"}");
        JsonNode grant = rpc("realtime/student-grant", REALTIME,
                Map.of("joinCode", joinCode, "participantToken", participant.get("participantToken").asText()));
        var held = new java.util.ArrayList<java.sql.Connection>();
        var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            for (int i = 0; i < applicationPool.getMaximumPoolSize(); i++) held.add(applicationPool.getConnection());
            JsonNode batch = executor.submit(() -> rpc("realtime/student-batch", REALTIME,
                    Map.of("joinCode", joinCode, "includeSnapshots", false, "subjects", List.of(Map.of(
                            "personId", grant.get("personId").asText(),
                            "authVersion", grant.get("authVersion").asLong())))))
                    .get(3, java.util.concurrent.TimeUnit.SECONDS);
            assertEquals(1, batch.get("allowed").size());
            assertEquals(applicationPool.getMaximumPoolSize(), applicationPool.getHikariPoolMXBean()
                    .getActiveConnections());
        } finally {
            for (var connection : held) connection.close();
            executor.shutdownNow();
        }
        assertEquals("off", jdbc.sql("show transaction_read_only").query(String.class).single());
    }

    @Test
    void leasesAreFencedAndDuplicateAcknowledgementsDoNotReleaseBudgetTwice() throws Exception {
        integration.sessionChanged("session.changed", sessionId);
        JsonNode first = claim().get(0);
        assertEquals(0, claim().size());
        jdbc.sql("update integration.outbox set lease_until = now() - interval '1 second'").update();
        JsonNode second = claim().get(0);
        assertNotEquals(first.get("claimToken"), second.get("claimToken"));
        assertEquals(0, ack(first, true));
        assertEquals(1, ack(second, true));
        assertEquals(0, ack(second, true));
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (count("integration.outbox") > 0 && System.nanoTime() < deadline) Thread.sleep(20);
        assertEquals(0L, count("integration.outbox"));
        assertEquals(0L, jdbc.sql("select sum(pending_bytes) from integration.outbox_budgets")
                .query(Long.class).single());
    }

    @Test
    void unconfirmedDeliveryBacksOffAndExhaustionRetainsBoundedDeadLetter() throws Exception {
        integration.sessionChanged("session.changed", sessionId);
        assertEquals(1, ack(claim().get(0), false));
        assertEquals(0, claim().size());
        jdbc.sql("update integration.outbox set next_attempt_at = now() - interval '1 second'").update();
        assertEquals(1, ack(claim().get(0), false));
        assertEquals(1L, count("integration.outbox where status = 'DEAD'"));
        assertEquals(0, claim().size());
        assertEquals(1L, jdbc.sql("select sum(pending_count) from integration.outbox_budgets")
                .query(Long.class).single());
    }

    @Test
    void fullLaneRejectsEntireTransaction() {
        UUID id = new UUID(100, 5);
        jdbc.sql("update integration.outbox_budgets set pending_count = 781").update();
        assertThrows(org.springframework.web.server.ResponseStatusException.class, () ->
                integration.append(id, "domain", "test", "test", id, null, Map.of()));
        assertEquals(0L, count("integration.aggregate_revisions"));
        assertEquals(0L, count("integration.outbox"));
    }

    @Test
    void serviceKeysAreScopedAndBatchGrantRejectsChangedAccountVersion() throws Exception {
        mockMvc.perform(post("/internal/v1/realtime/health").header("X-Service-Key", EVENTS))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/internal/v1/events/outbox/claim").header("X-Service-Key", REALTIME)
                .contentType(MediaType.APPLICATION_JSON).content("{\"owner\":\"" + UUID.randomUUID()
                        + "\",\"limit\":1,\"leaseSeconds\":30}"))
                .andExpect(status().isUnauthorized());
        JsonNode participant = join(null, "{\"displayName\":\"Student\"}");
        String token = participant.get("participantToken").asText();
        JsonNode grant = rpc("realtime/student-grant", REALTIME,
                Map.of("joinCode", joinCode, "participantToken", token));
        Map<String, Object> subject = Map.of("personId", grant.get("personId").asText(),
                "authVersion", grant.get("authVersion").asLong());
        Map<String, Object> request = Map.of("joinCode", joinCode, "subjects", List.of(subject),
                "includeSnapshots", true);
        assertEquals(1, rpc("realtime/student-batch", REALTIME, request).get("allowed").size());
        jdbc.sql("update iam.persons set auth_version = auth_version + 1 where id = :person")
                .param("person", UUID.fromString(grant.get("personId").asText())).update();
        JsonNode revoked = rpc("realtime/student-batch", REALTIME, request);
        assertEquals(0, revoked.get("allowed").size());
        assertEquals(0, revoked.get("overlays").size());
    }

    @Test
    void newModePublishesDurableInvalidationWithoutLocalBroker() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertTrue(count("integration.outbox where routing_key like 'realtime.%'") > 0);
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                "/api/v1/student/sessions/{c}/events/public", joinCode))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void largeCommonDrawingBecomesOneBoundedInvalidationInsteadOfCopiesPerStudent() throws Exception {
        var participant = join(null, "{\"displayName\":\"Student\"}");
        jdbc.sql("update live.sessions set annotations = cast(:json as jsonb), version = version + 1 where id = :id")
                .param("json", objectMapper.writeValueAsString(Map.of("large", "x".repeat(100000))))
                .param("id", sessionId).update();
        JsonNode grant = rpc("realtime/student-grant", REALTIME, Map.of("joinCode", joinCode,
                "participantToken", participant.get("participantToken").asText()));
        assertTrue(grant.at("/snapshot/gatewayInvalidation").asBoolean());
        JsonNode batch = rpc("realtime/student-batch", REALTIME, Map.of("joinCode", joinCode,
                "subjects", List.of(Map.of("personId", grant.get("personId").asText(),
                        "authVersion", grant.get("authVersion").asLong())), "includeSnapshots", true));
        assertEquals(1, batch.get("allowed").size());
        assertTrue(batch.at("/shared/gatewayInvalidation").asBoolean());
        assertEquals(0, batch.get("overlays").size());
        assertTrue(objectMapper.writeValueAsBytes(batch).length < 1024);
    }

    private JsonNode claim() throws Exception {
        return rpc("events/outbox/claim", EVENTS, Map.of("owner", UUID.randomUUID(),
                "limit", 256, "leaseSeconds", 30)).get("items");
    }

    private int ack(JsonNode claim, boolean delivered) throws Exception {
        return rpc("events/outbox/ack", EVENTS, Map.of("items", List.of(Map.of(
                "id", claim.get("id").asText(), "claimToken", claim.get("claimToken").asText(),
                "delivered", delivered)))).get("changed").asInt();
    }

    private JsonNode rpc(String path, String key, Object body) throws Exception {
        return json(post("/internal/v1/" + path).header("X-Service-Key", key)
                .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body)), 200);
    }
}
