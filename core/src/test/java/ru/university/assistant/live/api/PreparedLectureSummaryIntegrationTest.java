package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class PreparedLectureSummaryIntegrationTest extends LiveFlowTestBase {
    @Autowired MeterRegistry meters;
    @Autowired javax.sql.DataSource dataSource;

    @Test
    void preparedRowIsReusedAcrossRequestsAndSchemaChangeRebuildsIt() throws Exception {
        join(null, "{\"displayName\":\"First name\"}");
        end();
        JsonNode first = summary();
        assertEquals(1, first.get("participantCount").asInt());
        assertEquals(1L, count("analytics.lecture_summaries where session_id = '" + sessionId + "'"));
        double before = meter("hit");
        assertEquals(first, summary());
        assertTrue(meter("hit") > before);
        jdbc.sql("update analytics.lecture_summaries set schema_version = 0 where session_id = :session")
                .param("session", sessionId).update();
        double misses = meter("miss");
        assertEquals(first, summary());
        assertTrue(meter("miss") > misses);
        assertEquals(1L, count("analytics.lecture_summaries where schema_version = 1"));
    }

    @Test
    void directDatabaseParticipantEditsInvalidateAndRevokedManagerCannotReadPreparedPersonalData() throws Exception {
        join(null, "{\"displayName\":\"Original name\"}");
        end();
        assertEquals("Original name", summary().at("/participants/0/displayName").asText());
        jdbc.sql("update live.session_participants set display_name = 'External edit' where session_id = :session")
                .param("session", sessionId).update();
        assertEquals("External edit", summary().at("/participants/0/displayName").asText());
        jdbc.sql("update iam.persons set status = 'DISABLED' where email = 'lecturer@example.test'").update();
        mockMvc.perform(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                        .is4xxClientError());
    }

    @Test
    void operatorCanDropOnlyDerivedRowAndNextAuthorizedReadRebuildsIt() throws Exception {
        end();
        JsonNode first = summary();
        mockMvc.perform(delete("/internal/v1/operations/lecture-summaries/{s}", sessionId))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
        mockMvc.perform(delete("/internal/v1/operations/lecture-summaries/{s}", sessionId)
                .header("X-Internal-Api-Key", "phase-4-local-channel-key"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNoContent());
        assertEquals(0L, count("analytics.lecture_summaries"));
        assertEquals(first, summary());
        assertEquals(1L, count("analytics.lecture_summaries"));
        assertEquals(1L, count("live.sessions where id = '" + sessionId + "'"));
    }

    @Test
    void secondDatabaseBuilderReceivesBackpressureInsteadOfRepeatingTheExpensiveBuild() throws Exception {
        end();
        try (var connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try (var statement = connection.prepareStatement(
                    "select pg_advisory_xact_lock(hashtextextended(?, 0))")) {
                statement.setString(1, "lecture-summary:" + sessionId);
                statement.execute();
            }
            mockMvc.perform(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                    .header("Authorization", "Bearer " + lecturerToken))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                            .isServiceUnavailable())
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
                            .string("Retry-After", "2"));
            connection.rollback();
        }
        assertEquals("ENDED", summary().get("status").asText());
    }

    private double meter(String result) { return meters.counter("analytics.summary_cache", "result", result).count(); }
    private void end() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }
    private JsonNode summary() throws Exception {
        return json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }
}
