package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import ru.university.assistant.live.internal.LiveSessionService;
import ru.university.assistant.live.internal.AbandonedSessionCleanup;

@TestPropertySource(properties = "app.live.abandoned-cleanup-delay-ms=3600000")
class PresenterPresenceIntegrationTest extends LiveFlowTestBase {
    @Autowired
    LiveSessionService lifecycle;

    @Autowired
    AbandonedSessionCleanup cleanup;

    @Autowired
    PlatformTransactionManager transactions;

    @Test
    void timeoutCompletesOnceClosesPollAndPreservesResponsesAndSummary() throws Exception {
        String participant = join(null, "{\"displayName\":\"Student\"}").get("participantToken").asText();
        JsonNode poll = json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Question\",\"options\":[\"A\",\"B\"]}"), 201);
        String pollId = poll.at("/poll/id").asText();
        json(post("/api/v1/student/sessions/{c}/polls/{p}/respond", joinCode, pollId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + participant + "\",\"optionIdx\":0}"), 200);

        agePresence("29 minutes 59 seconds");
        assertFalse(lifecycle.endIfPresenterAbsent(sessionId));
        agePresence("30 minutes 1 second");
        cleanup.closeAbandonedSessions();
        assertEquals("ENDED", currentStatus());
        cleanup.closeAbandonedSessions();
        assertFalse(lifecycle.endIfPresenterAbsent(sessionId));
        assertEquals("CLOSED", jdbc.sql("select status from interaction.quick_polls where id = :id")
                .param("id", UUID.fromString(pollId)).query(String.class).single());
        JsonNode summary = json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals("ENDED", summary.path("status").asText());
        assertEquals(1, summary.path("participantCount").asInt());
        assertEquals(1, summary.at("/pollResults/0/totalResponses").asInt());
        assertEquals(1L, jdbc.sql("""
                select count(*) from analytics.events where aggregate_id = :id and verb = 'session.ended'
                    and actor_person_id is null and payload ->> 'reason' = 'presenter_absent_timeout'
                """).param("id", sessionId).query(Long.class).single());
        assertNotNull(seenAt());
        presence(lecturerToken, courseId, 204);
        assertEquals("ENDED", currentStatus());
    }

    @Test
    void eitherManagerCanRenewWithoutChangingVisibleRevisionOrWritingEveryRequest() throws Exception {
        long version = version();
        agePresence("29 minutes");
        presence(lecturerToken, courseId, 204);
        Instant renewed = seenAt();
        assertTrue(renewed.isAfter(Instant.now().minusSeconds(60)));
        assertFalse(lifecycle.endIfPresenterAbsent(sessionId));
        presence(adminToken, courseId, 204);
        assertEquals(renewed, seenAt(), "Multiple windows share one coalesced timestamp");
        assertEquals(version, version());
    }

    @Test
    void participantTrafficAndUnauthorizedOrForeignCourseRequestsCannotKeepItOpen() throws Exception {
        String participant = join(null, "{\"displayName\":\"Student\"}").get("participantToken").asText();
        agePresence("31 minutes");
        Instant absentSince = seenAt();
        json(get("/api/v1/student/sessions/{code}", joinCode)
                .header("X-Participant-Token", participant), 200);
        presence(maxLogin(7878), courseId, 403);
        UUID otherCourse = UUID.fromString(json(post("/api/v1/courses")
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Other\"}"), 201)
                .path("id").asText());
        presence(lecturerToken, otherCourse, 404);
        assertEquals(absentSince, seenAt());
        assertTrue(lifecycle.endIfPresenterAbsent(sessionId));
    }

    @Test
    void pausedSessionsExpireButPreparedAndUnmonitoredLegacySessionsDoNot() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        agePresence("31 minutes");
        assertTrue(lifecycle.endIfPresenterAbsent(sessionId));
        jdbc.sql("update live.sessions set status = 'SCHEDULED' where id = :id")
                .param("id", sessionId).update();
        presence(adminToken, courseId, 204);
        assertFalse(lifecycle.endIfPresenterAbsent(sessionId));
        jdbc.sql("update live.sessions set status = 'LIVE', presenter_seen_at = null where id = :id")
                .param("id", sessionId).update();
        assertFalse(lifecycle.endIfPresenterAbsent(sessionId));
        presence(adminToken, courseId, 204);
        assertNotNull(seenAt());
    }

    @Test
    void concurrentCleanupDoesNotDuplicateCompletionAndLockedSessionsAreRetriedLater() throws Exception {
        agePresence("31 minutes");
        try (var worker = Executors.newSingleThreadExecutor()) {
            new TransactionTemplate(transactions).executeWithoutResult(transaction -> {
                jdbc.sql("select id from live.sessions where id = :id for update")
                        .param("id", sessionId).query(UUID.class).single();
                try {
                    assertFalse(worker.submit(() -> lifecycle.endIfPresenterAbsent(sessionId))
                            .get(2, TimeUnit.SECONDS));
                } catch (Exception exception) { throw new AssertionError(exception); }
            });
        }
        presence(adminToken, courseId, 204);
        assertFalse(lifecycle.endIfPresenterAbsent(sessionId), "Return cancels a pending timeout");
        agePresence("31 minutes");
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Callable<Boolean>> attempts = List.of(
                    () -> lifecycle.endIfPresenterAbsent(sessionId),
                    () -> lifecycle.endIfPresenterAbsent(sessionId));
            int completed = 0;
            for (var result : pool.invokeAll(attempts)) if (result.get()) completed++;
            assertEquals(1, completed);
        }
        assertEquals(1L, jdbc.sql("select count(*) from analytics.events "
                        + "where aggregate_id = :id and verb = 'session.ended'")
                .param("id", sessionId).query(Long.class).single());
    }

    private void presence(String token, UUID course, int expected) throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/presenter-presence", course, sessionId)
                .header("Authorization", "Bearer " + token), expected);
    }

    private void agePresence(String interval) {
        jdbc.sql("update live.sessions set presenter_seen_at = now() - cast(:age as interval) where id = :id")
                .param("age", interval).param("id", sessionId).update();
    }

    private Instant seenAt() {
        return jdbc.sql("select presenter_seen_at from live.sessions where id = :id")
                .param("id", sessionId).query(Instant.class).single();
    }

    private long version() {
        return jdbc.sql("select version from live.sessions where id = :id")
                .param("id", sessionId).query(Long.class).single();
    }

    private String currentStatus() {
        return jdbc.sql("select status from live.sessions where id = :id")
                .param("id", sessionId).query(String.class).single();
    }
}
