package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class LectureSummaryIntegrationTest extends LiveFlowTestBase {

    @Test
    void endedLectureSummaryContainsParticipantsSignalsPollsAndUnansweredQuestions() throws Exception {
        String studentJwt = maxLogin(707);
        join(studentJwt, null);
        UUID questionId = createQuestion("Какой ответ верный?", "CHOICE",
                "[{\"text\":\"A\",\"correct\":false},{\"text\":\"B\",\"correct\":true}]");

        JsonNode started = json(post("/api/v1/courses/{c}/sessions/{s}/polls/from-bank", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionId\":\"" + questionId + "\"}"), 201);
        UUID pollId = UUID.fromString(started.get("poll").get("id").asText());
        assertEquals(questionId.toString(), started.get("poll").get("sourceQuestionId").asText());
        assertEquals(1, started.get("poll").get("correctOptionIdx").asInt());

        JsonNode openStudentPoll = json(get("/api/v1/student/sessions/{code}", joinCode)
                .header("Authorization", "Bearer " + studentJwt), 200).get("activePoll");
        assertTrue(openStudentPoll.get("correctOptionIdx").isNull());
        assertTrue(openStudentPoll.get("votes").isNull());

        json(post("/api/v1/student/sessions/{code}/signals", joinCode)
                .header("Authorization", "Bearer " + studentJwt)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"value\":\"RED\"}"), 200);
        json(post("/api/v1/student/sessions/{code}/questions", joinCode)
                .header("Authorization", "Bearer " + studentJwt)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"Можно ещё раз?\"}"), 201);
        json(post("/api/v1/student/sessions/{code}/polls/{poll}/respond", joinCode, pollId)
                .header("Authorization", "Bearer " + studentJwt)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"optionIdx\":1}"), 200);
        JsonNode closed = json(post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close",
                        courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(1, closed.get("poll").get("correctOptionIdx").asInt());

        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + studentJwt), 403);

        JsonNode summary = json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);

        assertEquals(sessionId.toString(), summary.get("sessionId").asText());
        assertEquals("ENDED", summary.get("status").asText());
        assertTrue(summary.get("durationSeconds").asLong() >= 0);
        assertEquals(1, summary.get("participantCount").asInt());
        assertEquals(1, summary.get("participants").size());
        assertEquals(1, summary.get("signalTotals").get("red").asInt());
        assertEquals(1, summary.get("problemSlides").size());
        assertEquals(1, summary.get("problemSlides").get(0).get("slideIdx").asInt());
        assertEquals(1, summary.get("pollResults").size());
        assertEquals("[0,1]", summary.get("pollResults").get(0).get("votes").toString());
        assertEquals(1, summary.get("pollResults").get(0).get("totalResponses").asInt());
        assertEquals(1, summary.get("questionsCount").asInt());
        assertEquals(1, summary.get("unansweredQuestionCount").asInt());
        assertEquals("Можно ещё раз?", summary.get("unansweredQuestions").get(0).get("text").asText());

        assertTrue(eventExists("miniapp.opened"));
        assertTrue(eventExists("interaction.poll_started"));
        assertTrue(eventExists("interaction.poll_answered"));
        assertTrue(eventExists("interaction.poll_closed"));
        assertTrue(eventExists("summary.opened"));
    }

    @Test
    void summaryIsUnavailableBeforeLectureEnds() throws Exception {
        json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 409);
        assertFalse(eventExists("summary.opened"));
    }

    @Test
    void summarySeparatesWallClockActiveAndPausedDuration() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(post("/api/v1/courses/{c}/sessions/{s}/resume", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);

        Instant startedAt = Instant.parse("2026-09-25T10:00:00Z");
        Instant endedAt = Instant.parse("2026-09-25T10:01:40Z");
        jdbc.sql("update live.sessions set started_at = :startedAt, ended_at = :endedAt where id = :sessionId")
                .param("startedAt", Timestamp.from(startedAt))
                .param("endedAt", Timestamp.from(endedAt))
                .param("sessionId", sessionId)
                .update();
        List<UUID> pauses = jdbc.sql("""
                        select id from analytics.events
                        where aggregate_id = :sessionId and verb = 'session.paused'
                        order by occurred_at, id
                        """)
                .param("sessionId", sessionId)
                .query(UUID.class)
                .list();
        UUID resumed = jdbc.sql("""
                        select id from analytics.events
                        where aggregate_id = :sessionId and verb = 'session.resumed'
                        """)
                .param("sessionId", sessionId)
                .query(UUID.class)
                .single();
        setEventTime(pauses.get(0), startedAt.plusSeconds(20));
        setEventTime(resumed, startedAt.plusSeconds(50));
        setEventTime(pauses.get(1), startedAt.plusSeconds(80));

        JsonNode summary = json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);

        assertEquals(100, summary.get("durationSeconds").asLong());
        assertEquals(50, summary.get("activeDurationSeconds").asLong());
        assertEquals(50, summary.get("pausedDurationSeconds").asLong());
    }

    @Test
    void bankPollRejectsQuestionWithoutExactlyOneCorrectOption() throws Exception {
        UUID questionId = createQuestion("Выберите ответы", "MULTIPLE_CHOICE",
                "[{\"text\":\"A\",\"correct\":true},{\"text\":\"B\",\"correct\":true}]");

        json(post("/api/v1/courses/{c}/sessions/{s}/polls/from-bank", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionId\":\"" + questionId + "\"}"), 422);

        assertEquals(0L, count("interaction.quick_polls"));
    }

    private UUID createQuestion(String text, String type, String options) throws Exception {
        JsonNode question = json(post("/api/v1/courses/{c}/questions", courseId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"" + text + "\",\"questionType\":\"" + type
                        + "\",\"options\":" + options + "}"), 201);
        return UUID.fromString(question.get("id").asText());
    }

    private boolean eventExists(String verb) {
        return jdbc.sql("select count(*) from analytics.events where verb = :verb")
                        .param("verb", verb)
                        .query(Long.class)
                        .single()
                > 0;
    }

    private void setEventTime(UUID eventId, Instant occurredAt) {
        jdbc.sql("update analytics.events set occurred_at = :occurredAt where id = :eventId")
                .param("occurredAt", Timestamp.from(occurredAt))
                .param("eventId", eventId)
                .update();
    }
}
