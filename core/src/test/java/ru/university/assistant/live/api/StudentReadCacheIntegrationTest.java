package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Exercises database revision invalidation without in-process domain events. */
class StudentReadCacheIntegrationTest extends LiveFlowTestBase {
    @Autowired MeterRegistry meters;
    @Autowired PlatformTransactionManager transactions;
    @Autowired ru.university.assistant.live.internal.StudentWebSessionService studentSessions;

    @Test
    void unchangedReadsReuseSharedDataButRawDatabaseEditsInvalidateSlideAndAggregates() throws Exception {
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();
        JsonNode original = snapshot();
        double before = hits();
        assertEquals(original, snapshot());
        assertTrue(hits() > before);
        jdbc.sql("update content.slides set text_extract = 'External writer' where deck_id = cast(:deck as uuid)")
                .param("deck", deckId).update();
        assertEquals("External writer", snapshot().at("/currentSlide/textExtract").asText());
        json(post("/api/v1/student/sessions/{code}/signals", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + token + "\",\"value\":\"GREEN\"}"), 200);
        assertEquals(1, snapshot().at("/signalAggregate/green").asInt());
        jdbc.sql("update feedback.comprehension_signals set value = 'RED' where session_id = :session")
                .param("session", sessionId).update();
        assertEquals(1, snapshot().at("/signalAggregate/red").asInt());
        assertFalse(snapshot().toString().contains("note"));
    }

    @Test
    void uncommittedSnapshotDoesNotPoisonCacheAfterRollback() throws Exception {
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();
        json(post("/api/v1/student/sessions/{code}/signals", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + token + "\",\"value\":\"GREEN\"}"), 200);
        assertEquals(1, snapshot().at("/signalAggregate/green").asInt());
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(transactions).execute(status -> {
            jdbc.sql("update feedback.comprehension_signals set value = 'RED' where session_id = :session")
                    .param("session", sessionId).update();
            try { assertEquals(1, snapshot().at("/signalAggregate/red").asInt()); }
            catch (Exception exception) { throw new IllegalStateException(exception); }
            throw new IllegalStateException("rollback");
        }));
        assertEquals(1, snapshot().at("/signalAggregate/green").asInt());
        assertEquals(0, snapshot().at("/signalAggregate/red").asInt());
    }

    @Test
    void answerAudienceRequiresActiveParticipationEvenWhenCourseAccessStillExists() throws Exception {
        join(null, "{\"displayName\":\"Active name\"}");
        java.util.UUID person = jdbc.sql("select person_id from live.session_participants where session_id = :session")
                .param("session", sessionId).query(java.util.UUID.class).single();
        assertTrue(studentSessions.canReceive(joinCode, person));
        jdbc.sql("update live.session_participants set left_at = now() where session_id = :session")
                .param("session", sessionId).update();
        assertFalse(studentSessions.canReceive(joinCode, person));
        jdbc.sql("update live.session_participants set left_at = null, kicked = true where session_id = :session")
                .param("session", sessionId).update();
        assertFalse(studentSessions.canReceive(joinCode, person));
    }

    private double hits() { return meters.counter("live.student.snapshot_cache", "result", "hit").count(); }
    private JsonNode snapshot() throws Exception {
        return json(get("/api/v1/student/sessions/{code}", joinCode), 200);
    }
}
