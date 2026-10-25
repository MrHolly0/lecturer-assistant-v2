package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class QuestionSlideIntegrationTest extends LiveFlowTestBase {
    @Test
    void questionKeepsTheStudentSlideAfterNavigationInEveryViewAndAnswer() throws Exception {
        String student = maxLogin(98741);
        join(student, null);
        changeSlide(2);
        JsonNode question = ask(student, "{\"text\":\"About the previous slide\","
                + "\"slideIdx\":1,\"anonymous\":true}", "previous-slide", 201);
        assertEquals(1, question.get("slideIdx").asInt());
        assertEquals("Анонимный вопрос", question.get("displayName").asText());
        assertEquals(1, snapshot(student).at("/myQuestions/0/slideIdx").asInt());
        assertEquals(1, engagement().at("/questions/0/slideIdx").asInt());
        assertEquals(1, questionPage().at("/items/0/slideIdx").asInt());
        changeSlide(1);
        assertEquals(1, engagement().get("questions").size());
        json(put("/api/v1/courses/{c}/sessions/{s}/questions/{q}",
                        courseId, sessionId, question.get("id").asText())
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"ANSWERED\",\"answerText\":\"Explanation\","
                        + "\"answerVisibility\":\"AUTHOR\"}"), 200);
        assertEquals(1, snapshot(student).at("/questionAnswers/0/slideIdx").asInt());
        String peer = maxLogin(98742);
        join(peer, null);
        assertEquals(0, snapshot(peer).get("questionAnswers").size());
        ask(student, "{\"text\":\"Still open\",\"slideIdx\":2}", "open-on-two", 201);
        end();
        assertEquals(2, summary().at("/unansweredQuestions/0/slideIdx").asInt());
        assertEquals(2, summary().at("/unansweredQuestions/0/slideIdx").asInt());
    }

    @Test
    void retryRetainsTheOriginalSlideAndRejectsChangingItWithTheSameKey() throws Exception {
        String student = maxLogin(98743);
        join(student, null);
        String body = "{\"text\":\"Question with retry\",\"slideIdx\":1}";
        JsonNode first = ask(student, body, "question-retry", 201);
        changeSlide(2);
        JsonNode retry = ask(student, body, "question-retry", 201);
        assertEquals(first.get("id"), retry.get("id"));
        assertEquals(1, retry.get("slideIdx").asInt());
        ask(student, body.replace("\"slideIdx\":1", "\"slideIdx\":2"), "question-retry", 409);
        assertEquals(1, count("qa.questions"));
        assertEquals(1, count("analytics.events where verb = 'qa.question_asked'"));
    }

    @Test
    void olderClientUsesCurrentSlideButRetryDoesNotFollowNavigation() throws Exception {
        String student = maxLogin(98744);
        join(student, null);
        changeSlide(2);
        String body = "{\"text\":\"Older client question\"}";
        JsonNode first = ask(student, body, "older-client", 201);
        assertEquals(2, first.get("slideIdx").asInt());
        changeSlide(1);
        assertEquals(first.get("id"), ask(student, body, "older-client", 201).get("id"));
        assertEquals(2, questionPage().at("/items/0/slideIdx").asInt());
    }

    @Test
    void nonexistentSlidesAreRejectedAndHistoricalUnknownSlideRemainsUnknown() throws Exception {
        String student = maxLogin(98745);
        join(student, null);
        for (int slide : new int[] {-1, 0, 3}) {
            ask(student, "{\"text\":\"Invalid slide\",\"slideIdx\":" + slide + "}", "bad-" + slide, 400);
        }
        assertEquals(0, count("qa.questions"));
        JsonNode old = ask(student, "{\"text\":\"Historical question\"}", "historical", 201);
        jdbc.sql("update qa.questions set slide_idx = null where id = cast(:id as uuid)")
                .param("id", old.get("id").asText()).update();
        changeSlide(2);
        assertTrue(questionPage().at("/items/0/slideIdx").isNull());
        assertTrue(snapshot(student).at("/myQuestions/0/slideIdx").isNull());
        end();
        assertTrue(summary().at("/unansweredQuestions/0/slideIdx").isNull());
    }

    private JsonNode ask(String token, String body, String key, int status) throws Exception {
        return json(post("/api/v1/student/sessions/{code}/questions", joinCode)
                .header("Authorization", "Bearer " + token).header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON).content(body), status);
    }

    private void changeSlide(int slideIdx) throws Exception {
        json(put("/api/v1/courses/{c}/sessions/{s}/slide", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"slideIdx\":" + slideIdx + "}"), 200);
    }

    private JsonNode snapshot(String token) throws Exception {
        return json(get("/api/v1/student/sessions/{code}", joinCode)
                .header("Authorization", "Bearer " + token), 200);
    }

    private JsonNode engagement() throws Exception {
        return json(get("/api/v1/courses/{c}/sessions/{s}/engagement", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private JsonNode questionPage() throws Exception {
        return json(get("/api/v1/courses/{c}/sessions/{s}/questions", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private void end() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private JsonNode summary() throws Exception {
        return json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }
}
