package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class ChannelDeliveryIntegrationTest extends LiveFlowTestBase {
    private static final String INTERNAL_KEY = "phase-4-local-channel-key";

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
