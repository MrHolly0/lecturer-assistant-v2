package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/** B-05: опросы (D-02, D-08, D-09, D-22). */
class PollIntegrationTest extends LiveFlowTestBase {

    @Test
    void closedPollStaysInStudentSnapshotWithAnswerAndDistribution() throws Exception {
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();
        UUID pollId = startPoll(sessionId);
        respond(joinCode, pollId, token, null, 1);

        closePoll(sessionId, pollId, 2);

        JsonNode poll = snapshot(joinCode, token, null).get("activePoll");
        assertEquals("CLOSED", poll.get("status").asText());
        assertEquals(2, poll.get("correctOptionIdx").asInt());
        assertEquals("[0,1,0]", poll.get("votes").toString());
        assertEquals(1, snapshot(joinCode, token, null).get("myVote").asInt());
        // и после нескольких «тиков» результат не пропадает
        assertEquals("CLOSED", snapshot(joinCode, null, null).get("activePoll").get("status").asText());
    }

    @Test
    void teacherStillSeesClosedPollResult() throws Exception {
        UUID pollId = startPoll(sessionId);
        closePoll(sessionId, pollId, 0);

        JsonNode active = json(get("/api/v1/courses/{c}/sessions/{s}/polls/active", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals("CLOSED", active.get("poll").get("status").asText());
    }

    @Test
    void openPollHidesDistributionAndAnswerFromStudents() throws Exception {
        String first = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();
        String second = join(null, "{\"displayName\":\"Боря\"}").get("participantToken").asText();
        UUID pollId = startPoll(sessionId);
        respond(joinCode, pollId, first, null, 0);
        respond(joinCode, pollId, second, null, 0);

        for (String viewer : new String[] {first, null}) {
            JsonNode poll = snapshot(joinCode, viewer, null).get("activePoll");
            assertEquals("OPEN", poll.get("status").asText());
            assertTrue(poll.get("votes").isNull(), "распределение до закрытия не отдаётся");
            assertTrue(poll.get("correctOptionIdx").isNull());
        }
        assertEquals(0, snapshot(joinCode, first, null).get("myVote").asInt());
        assertTrue(snapshot(joinCode, null, null).get("myVote").isNull());
    }

    @Test
    void correctAnswerSelectionIsSharedBetweenTeachersButHiddenFromStudentsUntilClose() throws Exception {
        UUID pollId = startPoll(sessionId);
        String path = "/api/v1/courses/{c}/sessions/{s}/polls/{p}/correct-option";

        JsonNode selected = json(put(path, courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":1}"), 200);
        assertEquals(1, selected.at("/poll/correctOptionIdx").asInt());

        JsonNode secondTeacherView = json(get("/api/v1/courses/{c}/sessions/{s}/polls/active", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(1, secondTeacherView.at("/poll/correctOptionIdx").asInt());
        assertTrue(snapshot(joinCode, null, null).at("/activePoll/correctOptionIdx").isNull());

        json(put(path, courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":null}"), 200);
        assertTrue(json(get("/api/v1/courses/{c}/sessions/{s}/polls/active", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200)
                .at("/poll/correctOptionIdx").isNull());

        json(put(path, courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":2}"), 200);
        json(post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close", courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"), 200);
        assertEquals(2, snapshot(joinCode, null, null).at("/activePoll/correctOptionIdx").asInt());
        json(put(path, courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":0}"), 409);
    }

    @Test
    void correctAnswerSelectionChecksRoleSessionAndOptionIndex() throws Exception {
        UUID pollId = startPoll(sessionId);
        String path = "/api/v1/courses/{c}/sessions/{s}/polls/{p}/correct-option";
        String studentJwt = maxLogin(808);
        JsonNode other = startAnotherSession();

        json(put(path, courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + studentJwt)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":0}"), 403);
        json(put(path, courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":3}"), 400);
        json(put(path, courseId, other.get("id").asText(), pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":0}"), 404);
    }

    @Test
    void repeatedAnswerIsNotCounted() throws Exception {
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();
        UUID pollId = startPoll(sessionId);

        JsonNode first = respond(joinCode, pollId, token, null, 0);
        JsonNode second = respond(joinCode, pollId, token, null, 2);
        closePoll(sessionId, pollId, 0);

        assertTrue(first.get("accepted").asBoolean());
        assertFalse(second.get("accepted").asBoolean());
        assertEquals(0, second.get("myVote").asInt());
        assertEquals("[1,0,0]", snapshot(joinCode, token, null).get("activePoll").get("votes").toString());
        assertEquals(1L, count("interaction.poll_responses"));
    }

    @Test
    void answerAfterCloseIsNotAccepted() throws Exception {
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();
        UUID pollId = startPoll(sessionId);
        closePoll(sessionId, pollId, 0);

        JsonNode late = respond(joinCode, pollId, token, null, 1);

        assertFalse(late.get("accepted").asBoolean());
        assertTrue(late.get("myVote").isNull());
        assertEquals(0L, count("interaction.poll_responses"));
    }

    @Test
    void pollOfAnotherSessionIsNotFound() throws Exception {
        JsonNode other = startAnotherSession();
        UUID foreignPoll = startPoll(UUID.fromString(other.get("id").asText()));
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();

        respondExpecting(joinCode, foreignPoll, token, null, 1, 404);

        assertEquals(0L, count("interaction.poll_responses"));
    }

    @Test
    void activityRunOfAnotherSessionIsNotFound() throws Exception {
        String question = json(post("/api/v1/courses/{c}/questions", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"2+2?\",\"questionType\":\"CHOICE\",\"options\":"
                                + "[{\"text\":\"4\",\"correct\":true},{\"text\":\"5\",\"correct\":false}]}"), 201)
                .get("id")
                .asText();
        String definition = json(post("/api/v1/courses/{c}/activities", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Check\",\"questionIds\":[\"" + question + "\"],\"strategy\":\"ALL\"}"),
                        201)
                .get("id")
                .asText();
        JsonNode other = startAnotherSession();
        String run = json(post("/api/v1/courses/{c}/sessions/{s}/activities/{d}/runs",
                                courseId, other.get("id").asText(), definition)
                        .header("Authorization", "Bearer " + lecturerToken), 201)
                .get("id")
                .asText();
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();

        json(post("/api/v1/student/sessions/{code}/activity-runs/{run}/respond", joinCode, run)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + token + "\",\"questionId\":\"" + question
                        + "\",\"answer\":{\"optionIdx\":0}}"), 404);

        assertEquals(0L, count("interaction.activity_responses"));
    }

    @Test
    void maxStudentVotesAndSeesOwnAnswerWithJwtOnly() throws Exception {
        String jwt = maxLogin(707);
        UUID pollId = startPoll(sessionId);

        JsonNode vote = respond(joinCode, pollId, null, jwt, 1);

        assertTrue(vote.get("accepted").asBoolean());
        assertEquals(1, snapshot(joinCode, null, jwt).get("myVote").asInt());
        assertEquals(1L, count("live.session_participants"));
    }

    @Test
    void pollCannotStartWhileSessionIsPaused() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);

        json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Что верно?\",\"options\":[\"A\",\"B\"]}"), 409);

        assertEquals(0L, count("interaction.quick_polls"));
    }

    @Test
    void manualAndBankPollCannotStartAfterSessionEnds() throws Exception {
        UUID questionId = UUID.fromString(json(post("/api/v1/courses/{c}/questions", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"2+2?\",\"questionType\":\"CHOICE\",\"options\":"
                                + "[{\"text\":\"4\",\"correct\":true},{\"text\":\"5\",\"correct\":false}]}"),
                        201)
                .get("id")
                .asText());
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);

        json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Что верно?\",\"options\":[\"A\",\"B\"]}"), 409);
        jdbc.sql("update live.sessions set status = 'ARCHIVED' where id = :sessionId")
                .param("sessionId", sessionId)
                .update();
        json(post("/api/v1/courses/{c}/sessions/{s}/polls/from-bank", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionId\":\"" + questionId + "\"}"), 409);

        assertEquals(0L, count("interaction.quick_polls"));
    }

    @Test
    void closedPollHistoryIsPaginatedNewestFirstAndScopedToSession() throws Exception {
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();
        UUID firstPoll = startPoll(sessionId);
        respond(joinCode, firstPoll, token, null, 1);
        closePoll(sessionId, firstPoll, 1);
        UUID secondPoll = startPoll(sessionId);
        closePoll(sessionId, secondPoll, 2);
        UUID openPoll = startPoll(sessionId);

        JsonNode otherSession = startAnotherSession();
        UUID otherSessionId = UUID.fromString(otherSession.get("id").asText());
        UUID otherPoll = startPoll(otherSessionId);
        closePoll(otherSessionId, otherPoll, 0);

        jdbc.sql("update interaction.quick_polls set closed_at = now() - interval '2 hours' where id = :id")
                .param("id", firstPoll)
                .update();
        jdbc.sql("update interaction.quick_polls set closed_at = now() - interval '1 hour' where id = :id")
                .param("id", secondPoll)
                .update();

        JsonNode firstPage = closedPolls(courseId, sessionId, lecturerToken, 1, 0, 200);
        assertEquals(2, firstPage.get("total").asInt());
        assertEquals(secondPoll.toString(), firstPage.at("/items/0/poll/id").asText());
        assertEquals("CLOSED", firstPage.at("/items/0/poll/status").asText());
        assertEquals(2, firstPage.at("/items/0/poll/correctOptionIdx").asInt());
        assertEquals("[0,0,0]", firstPage.at("/items/0/votes").toString());
        assertEquals(0, firstPage.at("/items/0/totalResponses").asInt());

        JsonNode secondPage = closedPolls(courseId, sessionId, lecturerToken, 1, 1, 200);
        assertEquals(firstPoll.toString(), secondPage.at("/items/0/poll/id").asText());
        assertEquals("[0,1,0]", secondPage.at("/items/0/votes").toString());
        assertEquals(1, secondPage.at("/items/0/totalResponses").asInt());
        assertFalse(secondPage.toString().contains(openPoll.toString()));
        assertFalse(secondPage.toString().contains(otherPoll.toString()));

        JsonNode otherHistory = closedPolls(courseId, otherSessionId, lecturerToken, 20, 0, 200);
        assertEquals(1, otherHistory.get("total").asInt());
        assertEquals(otherPoll.toString(), otherHistory.at("/items/0/poll/id").asText());
    }

    @Test
    void closedPollHistoryRequiresManageMatchingCourseAndValidPagination() throws Exception {
        String studentJwt = maxLogin(909);
        UUID otherCourseId = UUID.fromString(json(post("/api/v1/courses")
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Other course\"}"), 201)
                .get("id")
                .asText());

        closedPolls(courseId, sessionId, studentJwt, 20, 0, 403);
        closedPolls(otherCourseId, sessionId, lecturerToken, 20, 0, 404);
        closedPolls(courseId, sessionId, lecturerToken, 0, 0, 400);
        closedPolls(courseId, sessionId, lecturerToken, 101, 0, 400);
        closedPolls(courseId, sessionId, lecturerToken, 20, -1, 400);
    }

    private UUID startPoll(UUID session) throws Exception {
        JsonNode result = json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, session)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Что верно?\",\"options\":[\"A\",\"B\",\"C\"]}"), 201);
        return UUID.fromString(result.get("poll").get("id").asText());
    }

    private JsonNode closedPolls(UUID course, UUID session, String token, int limit, int offset, int expected)
            throws Exception {
        return json(get("/api/v1/courses/{c}/sessions/{s}/polls", course, session)
                .queryParam("limit", String.valueOf(limit))
                .queryParam("offset", String.valueOf(offset))
                .header("Authorization", "Bearer " + token), expected);
    }

    private void closePoll(UUID session, UUID pollId, int correct) throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close", courseId, session, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":" + correct + "}"), 200);
    }

    private JsonNode respond(String code, UUID pollId, String token, String jwt, int option) throws Exception {
        return respondExpecting(code, pollId, token, jwt, option, 200);
    }

    private JsonNode respondExpecting(String code, UUID pollId, String token, String jwt, int option, int expected)
            throws Exception {
        String body = token == null
                ? "{\"optionIdx\":" + option + "}"
                : "{\"participantToken\":\"" + token + "\",\"optionIdx\":" + option + "}";
        var request = post("/api/v1/student/sessions/{code}/polls/{poll}/respond", code, pollId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
        if (jwt != null) {
            request.header("Authorization", "Bearer " + jwt);
        }
        return json(request, expected);
    }

    private JsonNode snapshot(String code, String token, String jwt) throws Exception {
        var request = get("/api/v1/student/sessions/{code}", code);
        if (token != null) {
            request.header("X-Participant-Token", token);
        }
        if (jwt != null) {
            request.header("Authorization", "Bearer " + jwt);
        }
        return json(request, 200);
    }
}
