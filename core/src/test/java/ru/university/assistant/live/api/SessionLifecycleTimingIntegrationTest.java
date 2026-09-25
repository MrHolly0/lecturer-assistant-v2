package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class SessionLifecycleTimingIntegrationTest extends LiveFlowTestBase {

    @Test
    void waitingRoomBeginsOnceAndServerTimingSurvivesPauseSlideAndReload() throws Exception {
        end(sessionId);
        JsonNode scheduled = createScheduled();
        sessionId = UUID.fromString(scheduled.get("id").asText());
        joinCode = scheduled.get("joinCode").asText();

        assertEquals("SCHEDULED", scheduled.get("status").asText());
        assertTrue(scheduled.get("startedAt").isNull());
        assertEquals(0, scheduled.get("activeDurationSeconds").asLong());
        assertEquals(0, scheduled.get("currentSlideDurationSeconds").asLong());
        assertEquals(0, count("live.slide_log where session_id = '" + sessionId + "'"));

        JsonNode active = activeSession(200);
        assertEquals(sessionId.toString(), active.get("sessionId").asText());
        assertEquals("SCHEDULED", active.get("status").asText());
        assertTrue(active.get("startedAt").isNull());

        String student = maxLogin(9201);
        JsonNode waiting = join(student, null).get("snapshot");
        assertEquals("SCHEDULED", waiting.get("status").asText());
        json(post("/api/v1/student/sessions/{code}/signals", joinCode)
                .header("Authorization", "Bearer " + student)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"value\":\"GREEN\"}"), 409);
        json(post("/api/v1/courses/{course}/sessions/{session}/begin", courseId, sessionId)
                .header("Authorization", "Bearer " + student), 403);

        JsonNode started = begin(sessionId);
        assertEquals("LIVE", started.get("status").asText());
        assertFalse(started.get("startedAt").isNull());
        assertEquals(1, count("live.slide_log where session_id = '" + sessionId + "'"));
        assertEquals(1, eventCount("session.started"));

        begin(sessionId);
        assertEquals(1, count("live.slide_log where session_id = '" + sessionId + "'"));
        assertEquals(1, eventCount("session.started"));

        pause();
        assertEquals("PAUSED", begin(sessionId).get("status").asText());
        assertEquals(1, count("live.slide_log where session_id = '" + sessionId + "'"));
        assertEquals(1, eventCount("session.started"));
        resume();
        changeSlide(2);
        changeSlide(1);
        pause();
        backdateTimeline();

        JsonNode firstRead = session();
        assertEquals("PAUSED", firstRead.get("status").asText());
        assertBetween(firstRead.get("activeDurationSeconds").asLong(), 69, 71);
        assertBetween(firstRead.get("currentSlideDurationSeconds").asLong(), 19, 21);
        assertFalse(firstRead.get("timingCalculatedAt").isNull());

        JsonNode secondRead = session();
        assertEquals(firstRead.get("activeDurationSeconds").asLong(),
                secondRead.get("activeDurationSeconds").asLong());
        assertEquals(firstRead.get("currentSlideDurationSeconds").asLong(),
                secondRead.get("currentSlideDurationSeconds").asLong());
        assertEquals("PAUSED", activeSession(200).get("status").asText());
        assertEquals("PAUSED", join(student, null).get("snapshot").get("status").asText());

        resume();
        JsonNode ended = end(sessionId);
        assertEquals("ENDED", ended.get("status").asText());
        JsonNode summary = json(get("/api/v1/courses/{course}/sessions/{session}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(ended.get("activeDurationSeconds").asLong(), summary.get("activeDurationSeconds").asLong());
        activeSession(204);
    }

    @Test
    void scheduledSessionCanBeCancelledWithoutStartingItsClock() throws Exception {
        end(sessionId);
        JsonNode scheduled = createScheduled();
        sessionId = UUID.fromString(scheduled.get("id").asText());
        joinCode = scheduled.get("joinCode").asText();

        JsonNode cancelled = end(sessionId);
        assertEquals("ENDED", cancelled.get("status").asText());
        assertTrue(cancelled.get("startedAt").isNull());
        assertEquals(0, cancelled.get("activeDurationSeconds").asLong());
        assertEquals(0, count("live.slide_log where session_id = '" + sessionId + "'"));
        assertEquals(1, eventCount("session.cancelled"));
        assertEquals(0, eventCount("session.started"));
        json(post("/api/v1/courses/{course}/sessions/{session}/begin", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 409);
        json(post("/api/v1/student/sessions/{code}/join", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"), 409);
        activeSession(204);
    }

    private JsonNode createScheduled() throws Exception {
        return json(post("/api/v1/courses/{course}/lectures/{lecture}/sessions", courseId, lectureId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"groups\":[{\"groupId\":\"" + groupId + "\"}]}"), 201);
    }

    private JsonNode activeSession(int status) throws Exception {
        return json(get("/api/v1/me/active-session").header("Authorization", "Bearer " + lecturerToken), status);
    }

    private JsonNode session() throws Exception {
        return json(get("/api/v1/courses/{course}/sessions/{session}", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private void pause() throws Exception {
        json(post("/api/v1/courses/{course}/sessions/{session}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private void resume() throws Exception {
        json(post("/api/v1/courses/{course}/sessions/{session}/resume", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private void changeSlide(int slideIdx) throws Exception {
        json(put("/api/v1/courses/{course}/sessions/{session}/slide", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"slideIdx\":" + slideIdx + "}"), 200);
    }

    private JsonNode end(UUID targetSession) throws Exception {
        return json(post("/api/v1/courses/{course}/sessions/{session}/end", courseId, targetSession)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private long eventCount(String verb) {
        return count("analytics.events where aggregate_id = '" + sessionId + "' and verb = '" + verb + "'");
    }

    private void backdateTimeline() {
        Instant start = Instant.now().minusSeconds(100);
        jdbc.sql("update live.sessions set started_at = :startedAt where id = :sessionId")
                .param("startedAt", Timestamp.from(start))
                .param("sessionId", sessionId)
                .update();

        List<UUID> logs = jdbc.sql(
                        "select id from live.slide_log where session_id = :sessionId order by entered_at, id")
                .param("sessionId", sessionId)
                .query(UUID.class)
                .list();
        setSlideTime(logs.get(0), start);
        setSlideTime(logs.get(1), start.plusSeconds(60));
        setSlideTime(logs.get(2), start.plusSeconds(70));

        List<UUID> pauses = eventIds("session.paused");
        List<UUID> resumes = eventIds("session.resumed");
        setEventTime(pauses.get(0), start.plusSeconds(30));
        setEventTime(resumes.get(0), start.plusSeconds(50));
        setEventTime(pauses.get(1), start.plusSeconds(90));
    }

    private List<UUID> eventIds(String verb) {
        return jdbc.sql(
                        """
                        select id from analytics.events
                        where aggregate_id = :sessionId and verb = :verb
                        order by occurred_at, id
                        """)
                .param("sessionId", sessionId)
                .param("verb", verb)
                .query(UUID.class)
                .list();
    }

    private void setEventTime(UUID id, Instant time) {
        jdbc.sql("update analytics.events set occurred_at = :time where id = :id")
                .param("time", Timestamp.from(time))
                .param("id", id)
                .update();
    }

    private void setSlideTime(UUID id, Instant time) {
        jdbc.sql("update live.slide_log set entered_at = :time where id = :id")
                .param("time", Timestamp.from(time))
                .param("id", id)
                .update();
    }

    private void assertBetween(long actual, long minimum, long maximum) {
        assertTrue(actual >= minimum && actual <= maximum,
                () -> "Expected " + actual + " between " + minimum + " and " + maximum);
    }
}
