package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class PausedSessionIntegrationTest extends LiveFlowTestBase {

    @Test
    void pauseFreezesMutationsPreservesOpenWorkAndResumeRestoresThem() throws Exception {
        JsonNode joined = join(null, "{\"displayName\":\"Аня\"}");
        String participantToken = joined.get("participantToken").asText();
        UUID pollId = startPoll();
        ActivityFixture activity = startActivity();

        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);

        JsonNode paused = json(get("/api/v1/student/sessions/{code}", joinCode), 200);
        assertEquals("PAUSED", paused.get("status").asText());
        assertEquals(pollId.toString(), paused.at("/activePoll/pollId").asText());
        join(null, "{\"participantToken\":\"" + participantToken + "\"}");

        studentMutation("/api/v1/student/sessions/{code}/signals",
                "{\"participantToken\":\"" + participantToken + "\",\"value\":\"RED\"}", 409);
        studentMutation("/api/v1/student/sessions/{code}/questions",
                "{\"participantToken\":\"" + participantToken + "\",\"text\":\"Вопрос\"}", 409);
        studentMutation("/api/v1/student/sessions/{code}/polls/" + pollId + "/respond",
                "{\"participantToken\":\"" + participantToken + "\",\"optionIdx\":0}", 409);
        studentMutation("/api/v1/student/sessions/{code}/activity-runs/" + activity.runId() + "/respond",
                "{\"participantToken\":\"" + participantToken + "\",\"questionId\":\""
                        + activity.questionId() + "\",\"answer\":{\"optionIdx\":0}}", 409);

        json(put("/api/v1/courses/{c}/sessions/{s}/slide", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"slideIdx\":1}"), 409);
        json(put("/api/v1/courses/{c}/sessions/{s}/annotations", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"annotations\":{\"x\":1}}"), 409);
        json(post("/api/v1/courses/{c}/sessions/{s}/activities/{d}/runs",
                        courseId, sessionId, activity.definitionId())
                .header("Authorization", "Bearer " + lecturerToken), 409);

        assertEquals(0L, count("feedback.comprehension_signals"));
        assertEquals(0L, count("qa.questions"));
        assertEquals(0L, count("interaction.poll_responses"));
        assertEquals(0L, count("interaction.activity_responses"));

        json(post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close", courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":0}"), 200);
        json(post("/api/v1/courses/{c}/sessions/{s}/activity-runs/{r}/close",
                        courseId, sessionId, activity.runId())
                .header("Authorization", "Bearer " + lecturerToken), 200);

        json(post("/api/v1/courses/{c}/sessions/{s}/resume", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        studentMutation("/api/v1/student/sessions/{code}/signals",
                "{\"participantToken\":\"" + participantToken + "\",\"value\":\"GREEN\"}", 200);
        studentMutation("/api/v1/student/sessions/{code}/questions",
                "{\"participantToken\":\"" + participantToken + "\",\"text\":\"После паузы\"}", 201);

        assertEquals(1L, count("feedback.comprehension_signals"));
        assertEquals(1L, count("qa.questions"));
        assertEquals(1L, count("analytics.events where verb = 'session.paused'"));
        assertEquals(1L, count("analytics.events where verb = 'session.resumed'"));
    }

    @Test
    void invalidRepeatedTransitionsReturnConflictAndPausedSessionCanEnd() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/resume", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 409);
        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 409);
        JsonNode ended = json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals("ENDED", ended.get("status").asText());
    }

    private UUID startPoll() throws Exception {
        return UUID.fromString(json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, sessionId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"questionText\":\"Что верно?\",\"options\":[\"A\",\"B\"]}"), 201)
                .at("/poll/id")
                .asText());
    }

    private ActivityFixture startActivity() throws Exception {
        UUID questionId = UUID.fromString(json(post("/api/v1/courses/{c}/questions", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"2+2?\",\"questionType\":\"CHOICE\",\"options\":"
                                + "[{\"text\":\"4\",\"correct\":true},{\"text\":\"5\",\"correct\":false}]}"), 201)
                .get("id")
                .asText());
        UUID definitionId = UUID.fromString(json(post("/api/v1/courses/{c}/activities", courseId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Check\",\"questionIds\":[\"" + questionId
                                + "\"],\"strategy\":\"ALL\"}"), 201)
                .get("id")
                .asText());
        UUID runId = UUID.fromString(json(post("/api/v1/courses/{c}/sessions/{s}/activities/{d}/runs",
                        courseId, sessionId, definitionId)
                .header("Authorization", "Bearer " + lecturerToken), 201).get("id").asText());
        return new ActivityFixture(questionId, definitionId, runId);
    }

    private void studentMutation(String url, String body, int expected) throws Exception {
        json(post(url, joinCode).contentType(MediaType.APPLICATION_JSON).content(body), expected);
    }

    private record ActivityFixture(UUID questionId, UUID definitionId, UUID runId) {}
}
