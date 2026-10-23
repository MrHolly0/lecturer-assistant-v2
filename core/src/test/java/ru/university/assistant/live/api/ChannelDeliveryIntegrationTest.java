package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.beans.factory.annotation.Autowired;
import ru.university.assistant.channel.api.ChannelInternalApi;

class ChannelDeliveryIntegrationTest extends LiveFlowTestBase {
    private static final String INTERNAL_KEY = "phase-4-local-channel-key";

    @Autowired
    ChannelInternalApi channelApi;

    @Test
    void sharedProviderBudgetSerializesConcurrentAdaptersAndPreservesCooldown() throws Exception {
        jdbc.sql("delete from channel.rate_budgets where channel_type = 'max'").update();
        var pool = java.util.concurrent.Executors.newFixedThreadPool(8);
        try {
            var start = new java.util.concurrent.CountDownLatch(1);
            var tasks = java.util.stream.IntStream.range(0, 8).mapToObj(i -> pool.submit(() -> {
                start.await();
                return channelApi.reserveRateSlot("max").delayMs();
            })).toList();
            start.countDown();
            var delays = new java.util.ArrayList<Long>();
            for (var task : tasks) delays.add(task.get(10, java.util.concurrent.TimeUnit.SECONDS));
            assertTrue(java.util.Collections.max(delays) >= 250,
                    "parallel callers must not each get an immediate provider slot");
            channelApi.deferChannel("max", 60_000);
            long first = channelApi.reserveRateSlot("max").delayMs();
            channelApi.deferChannel("max", 1000);
            long second = channelApi.reserveRateSlot("max").delayMs();
            assertTrue(first >= 59_000);
            assertTrue(second >= 59_000, "shorter cooldown must not overwrite Retry-After");
            assertTrue(second <= first + 100, "rejected reservations must not grow an unbounded queue");
        } finally {
            pool.shutdownNow();
            jdbc.sql("delete from channel.rate_budgets where channel_type = 'max'").update();
        }
    }

    @Test
    void providerSlotNeverGrantsAnUnreservedBoundaryDelay() {
        try {
            for (int futureMs : new int[] {2001, 2030, 2066, 2500}) {
                jdbc.sql("delete from channel.rate_budgets where channel_type = 'max'").update();
                var before = jdbc.sql("""
                        insert into channel.rate_budgets(channel_type, next_slot_at)
                        values ('max', clock_timestamp() + (:future * interval '1 millisecond'))
                        returning next_slot_at
                        """).param("future", futureMs).query(java.time.OffsetDateTime.class).single();
                var slot = channelApi.reserveRateSlot("max");
                var after = jdbc.sql("select next_slot_at from channel.rate_budgets where channel_type = 'max'")
                        .query(java.time.OffsetDateTime.class).single();
                if (slot.reserved()) {
                    assertTrue(after.isAfter(before), "a granted slot must atomically advance the provider budget");
                } else {
                    assertEquals(before, after);
                    assertTrue(slot.delayMs() > 2000, "rejected reservation must be unambiguous to the adapter");
                }
            }
        } finally {
            jdbc.sql("delete from channel.rate_budgets where channel_type = 'max'").update();
        }
    }

    @Test
    void staleFailedAttemptCannotDowngradeDeliveredMessage() throws Exception {
        String studentToken = maxLogin(8841);
        UUID personId = UUID.fromString(personIdOf(studentToken));
        UUID identityId = jdbc.sql("""
                        select id from iam.channel_identities
                        where person_id = :personId and channel_type = 'max'
                        """)
                .param("personId", personId)
                .query(UUID.class)
                .single();
        UUID messageId = UUID.randomUUID();
        jdbc.sql("""
                        insert into channel.outbox
                            (id, channel_type, channel_identity_id, priority, content, keyboard, reply_mode,
                             thread_key, status)
                        values (:id, 'max', :identityId, 'P0_INTERACTIVE',
                            '{\"type\":\"TEXT\",\"text\":\"delivery test\"}'::jsonb,
                            '[]'::jsonb, 'NEW', 'test', 'QUEUED')
                        """)
                .param("id", messageId)
                .param("identityId", identityId)
                .update();

        JsonNode first = pollOne();
        String firstToken = first.get("attemptToken").asText();
        report(messageId, firstToken, "FAILED");
        jdbc.sql("update channel.outbox set next_attempt_at = now() where id = :id")
                .param("id", messageId)
                .update();

        JsonNode second = pollOne();
        String secondToken = second.get("attemptToken").asText();
        assertNotEquals(firstToken, secondToken);
        report(messageId, secondToken, "DELIVERED");
        report(messageId, firstToken, "FAILED");

        assertEquals("DELIVERED", jdbc.sql("select status from channel.outbox where id = :id")
                .param("id", messageId)
                .query(String.class)
                .single());
        assertEquals(3L, count("channel.delivery_reports where outbox_id = '" + messageId + "'"));
    }

    private JsonNode pollOne() throws Exception {
        return json(get("/internal/v1/channels/max/outbox?wait=0s&limit=1")
                        .header("X-Internal-Api-Key", INTERNAL_KEY), 200)
                .at("/messages/0");
    }

    private void report(UUID messageId, String attemptToken, String status) throws Exception {
        String body = objectMapper.writeValueAsString(java.util.Map.of(
                "reports", java.util.List.of(java.util.Map.of(
                        "messageId", messageId,
                        "attemptToken", attemptToken,
                        "status", status,
                        "errorMessage", "test"))));
        mockMvc.perform(post("/internal/v1/channels/max/delivery-reports")
                        .header("X-Internal-Api-Key", INTERNAL_KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isNoContent());
    }
}
