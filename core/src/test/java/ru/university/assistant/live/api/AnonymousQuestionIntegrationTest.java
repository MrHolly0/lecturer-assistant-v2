package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class AnonymousQuestionIntegrationTest extends LiveFlowTestBase {
    @Test
    void anonymousQuestionHidesNameFromTeacherSummaryAndPersonalAnalytics() throws Exception {
        String author = maxLogin(98601);
        join(author, null);
        JsonNode created = ask(author, true);
        String personId = personIdOf(author);
        assertTrue(created.get("anonymous").asBoolean());
        assertEquals("Анонимный вопрос", created.get("displayName").asText());
        JsonNode engagement = json(get("/api/v1/courses/{course}/sessions/{session}/engagement", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals("Анонимный вопрос", engagement.at("/questions/0/displayName").asText());
        assertFalse(engagement.toString().contains(personId));
        assertEquals(0, count("analytics.events where aggregate_type='qa.question' and actor_person_id='"
                + personId + "'"));
        JsonNode analytics = json(get("/api/v1/courses/{course}/analytics/students/{person}", courseId, personId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(0, analytics.at("/metrics/questionsAsked").asInt(-1));
        json(post("/api/v1/courses/{course}/sessions/{session}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        JsonNode summary = json(get("/api/v1/courses/{course}/sessions/{session}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(1, summary.get("questionsCount").asInt());
        assertTrue(summary.at("/unansweredQuestions/0/anonymous").asBoolean());
        assertEquals("Анонимный вопрос", summary.at("/unansweredQuestions/0/displayName").asText());
    }

    @Test
    void anonymousAuthorReceivesPrivateAnswerAndBroadcastDoesNotExposeIdentity() throws Exception {
        String author = maxLogin(98602);
        String peer = maxLogin(98603);
        join(author, null);
        join(peer, null);
        JsonNode question = ask(author, true);
        answer(question.get("id").asText(), "Только автору", "AUTHOR");
        JsonNode mine = snapshot(author);
        assertEquals("Только автору", mine.at("/questionAnswers/0/answerText").asText());
        assertEquals(0, snapshot(peer).get("questionAnswers").size());
        JsonNode second = ask(author, true);
        JsonNode answered = answer(second.get("id").asText(), "Для аудитории", "SESSION");
        assertEquals("Анонимный вопрос", answered.get("displayName").asText());
        JsonNode audience = snapshot(peer).get("questionAnswers");
        assertEquals(1, audience.size());
        assertFalse(audience.toString().contains(personIdOf(author)));
        assertFalse(audience.toString().contains("Иван"));
        assertEquals("Для аудитории", audience.get(0).get("answerText").asText());
    }

    @Test
    void ordinaryQuestionRemainsNamedByDefault() throws Exception {
        String author = maxLogin(98604);
        join(author, null);
        JsonNode question = json(post("/api/v1/student/sessions/{code}/questions", joinCode)
                .header("Authorization", "Bearer " + author)
                .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"Обычный вопрос\"}"), 201);
        assertFalse(question.get("anonymous").asBoolean());
        assertTrue(question.get("displayName").asText().contains("Иван"));
    }

    private JsonNode ask(String token, boolean anonymous) throws Exception {
        return json(post("/api/v1/student/sessions/{code}/questions", joinCode)
                .header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("text", "Объясните пример", "anonymous", anonymous))), 201);
    }

    private JsonNode answer(String id, String text, String visibility) throws Exception {
        return json(put("/api/v1/courses/{course}/sessions/{session}/questions/{id}", courseId, sessionId, id)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "status", "ANSWERED", "answerText", text, "answerVisibility", visibility))), 200);
    }

    private JsonNode snapshot(String token) throws Exception {
        return json(get("/api/v1/student/sessions/{code}", joinCode)
                .header("Authorization", "Bearer " + token), 200);
    }
}
