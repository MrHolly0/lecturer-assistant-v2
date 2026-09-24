package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

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

    private UUID startPoll(UUID session) throws Exception {
        JsonNode result = json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, session)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Что верно?\",\"options\":[\"A\",\"B\",\"C\"]}"), 201);
        return UUID.fromString(result.get("poll").get("id").asText());
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
