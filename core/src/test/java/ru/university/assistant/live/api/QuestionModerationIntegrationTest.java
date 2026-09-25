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

class QuestionModerationIntegrationTest extends LiveFlowTestBase {

    @Test
    void lecturerAnswersQuestionAndExactRetryIsIdempotent() throws Exception {
        String student = maxLogin(3101);
        join(student, null);
        UUID questionId = ask(student, "Можно привести пример?");

        JsonNode answered = update(questionId, sessionId, lecturerToken,
                "{\"status\":\"ANSWERED\",\"answerText\":\"  Да, после формулы.  \"}", 200);
        assertEquals("ANSWERED", answered.get("status").asText());
        assertEquals("Да, после формулы.", answered.get("answerText").asText());
        assertFalse(answered.get("answeredAt").isNull());
        assertEquals(0, engagement().get("questions").size());
        assertEquals(1, count("analytics.events where verb = 'qa.question_answered'"));

        update(questionId, sessionId, lecturerToken,
                "{\"status\":\"ANSWERED\",\"answerText\":\"Да, после формулы.\"}", 200);
        assertEquals(1, count("analytics.events where verb = 'qa.question_answered'"));
        update(questionId, sessionId, lecturerToken,
                "{\"status\":\"ANSWERED\",\"answerText\":\"Другой ответ\"}", 409);
        update(questionId, sessionId, lecturerToken, "{\"status\":\"OPEN\"}", 400);
    }

    @Test
    void dismissalChecksManagerAndQuestionSessionScope() throws Exception {
        String student = maxLogin(3102);
        join(student, null);
        UUID questionId = ask(student, "Вопрос не по теме");
        UUID otherSessionId = UUID.fromString(startAnotherSession().get("id").asText());

        update(questionId, sessionId, student, "{\"status\":\"DISMISSED\"}", 403);
        update(questionId, otherSessionId, lecturerToken, "{\"status\":\"DISMISSED\"}", 404);
        JsonNode dismissed = update(
                questionId, sessionId, lecturerToken, "{\"status\":\"DISMISSED\"}", 200);
        assertEquals("DISMISSED", dismissed.get("status").asText());
        assertTrue(dismissed.get("answerText").isNull());
        assertFalse(dismissed.get("answeredAt").isNull());
        update(questionId, sessionId, lecturerToken, "{\"status\":\"DISMISSED\"}", 200);
        assertEquals(1, count("analytics.events where verb = 'qa.question_dismissed'"));
    }

    private UUID ask(String student, String text) throws Exception {
        return UUID.fromString(json(post("/api/v1/student/sessions/{code}/questions", joinCode)
                        .header("Authorization", "Bearer " + student)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(java.util.Map.of("text", text))), 201)
                .get("id")
                .asText());
    }

    private JsonNode update(UUID questionId, UUID targetSessionId, String token, String body, int status)
            throws Exception {
        return json(put("/api/v1/courses/{course}/sessions/{session}/questions/{question}",
                        courseId, targetSessionId, questionId)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body), status);
    }

    private JsonNode engagement() throws Exception {
        return json(get("/api/v1/courses/{course}/sessions/{session}/engagement", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }
}
