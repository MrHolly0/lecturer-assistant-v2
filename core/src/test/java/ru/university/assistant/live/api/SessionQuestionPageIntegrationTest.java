package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import ru.university.assistant.shared.api.UuidV7;

class SessionQuestionPageIntegrationTest extends LiveFlowTestBase {

    @Test
    void staffCanPageEachModerationStatusAndCountsStayIndependentOfSelection() throws Exception {
        String student = maxLogin(7201);
        join(student, null);
        UUID oldestOpen = ask(student, "Open oldest", false);
        UUID answered = ask(student, "Answered question", false);
        UUID dismissed = ask(student, "Dismissed question", false);
        UUID newestOpen = ask(student, "Anonymous newest", true);
        setCreatedAt(oldestOpen, "2026-10-18T10:00:00Z");
        setCreatedAt(answered, "2026-10-18T10:30:00Z");
        setCreatedAt(dismissed, "2026-10-18T11:00:00Z");
        setCreatedAt(newestOpen, "2026-10-18T12:00:00Z");

        update(answered, "{\"status\":\"ANSWERED\",\"answerText\":\"Answer\","
                + "\"answerVisibility\":\"SESSION\"}", 200);
        update(dismissed, "{\"status\":\"DISMISSED\"}", 200);

        JsonNode defaultPage = json(get("/api/v1/courses/{course}/sessions/{session}/questions", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(50, defaultPage.get("limit").asInt());
        assertEquals(0, defaultPage.get("offset").asInt());
        assertEquals(2, defaultPage.get("total").asInt());
        assertCounts(defaultPage, 2, 1, 1);

        JsonNode openFirstPage = questionsPage(courseId, sessionId, lecturerToken, null, 1, 0, 200);
        assertEquals(2, openFirstPage.get("total").asInt());
        assertEquals(1, openFirstPage.get("items").size());
        assertEquals(newestOpen.toString(), openFirstPage.at("/items/0/id").asText());
        assertEquals("Анонимный вопрос", openFirstPage.at("/items/0/displayName").asText());
        assertFalse(openFirstPage.toString().contains("Иван Петров"));
        assertCounts(openFirstPage, 2, 1, 1);

        JsonNode openSecondPage = questionsPage(courseId, sessionId, lecturerToken, "OPEN", 1, 1, 200);
        assertEquals(2, openSecondPage.get("total").asInt());
        assertEquals(oldestOpen.toString(), openSecondPage.at("/items/0/id").asText());
        assertCounts(openSecondPage, 2, 1, 1);

        JsonNode answeredPage = questionsPage(courseId, sessionId, lecturerToken, "ANSWERED", 50, 0, 200);
        assertEquals(answered.toString(), answeredPage.at("/items/0/id").asText());
        assertEquals("Answer", answeredPage.at("/items/0/answerText").asText());
        assertCounts(answeredPage, 2, 1, 1);

        JsonNode dismissedPage = questionsPage(courseId, sessionId, lecturerToken, "DISMISSED", 50, 0, 200);
        assertEquals(dismissed.toString(), dismissedPage.at("/items/0/id").asText());
        assertEquals("DISMISSED", dismissedPage.at("/items/0/status").asText());
        assertCounts(dismissedPage, 2, 1, 1);

        JsonNode engagement = json(get("/api/v1/courses/{course}/sessions/{session}/engagement", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(2, engagement.get("questions").size());
        assertFalse(engagement.toString().contains(answered.toString()));
        assertFalse(engagement.toString().contains(dismissed.toString()));
    }

    @Test
    void staffQuestionPageEnforcesCourseSessionScopeAndPagination() throws Exception {
        questionsPage(courseId, sessionId, maxLogin(7202), null, 50, 0, 403);
        questionsPage(courseId, sessionId, lecturerToken, "UNKNOWN", 50, 0, 400);
        questionsPage(courseId, sessionId, lecturerToken, "OPEN", 0, 0, 400);
        questionsPage(courseId, sessionId, lecturerToken, "OPEN", 101, 0, 400);
        questionsPage(courseId, sessionId, lecturerToken, "OPEN", 50, -1, 400);

        UUID otherCourse = UUID.fromString(json(post("/api/v1/courses")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Private course\"}"), 201)
                .get("id")
                .asText());
        UUID sessionInOtherCourse = createSessionInOtherCourse(otherCourse);
        questionsPage(otherCourse, sessionId, lecturerToken, "OPEN", 50, 0, 403);
        questionsPage(courseId, sessionInOtherCourse, lecturerToken, "OPEN", 50, 0, 404);
    }

    private UUID ask(String student, String text, boolean anonymous) throws Exception {
        return UUID.fromString(json(post("/api/v1/student/sessions/{code}/questions", joinCode)
                        .header("Authorization", "Bearer " + student)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.createObjectNode()
                                .put("text", text)
                                .put("anonymous", anonymous)
                                .toString()), 201)
                .get("id")
                .asText());
    }

    private JsonNode update(UUID questionId, String body, int expected) throws Exception {
        return json(put("/api/v1/courses/{course}/sessions/{session}/questions/{question}",
                        courseId, sessionId, questionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body), expected);
    }

    private JsonNode questionsPage(
            UUID course, UUID session, String token, String status, int limit, int offset, int expected)
            throws Exception {
        var request = get("/api/v1/courses/{course}/sessions/{session}/questions", course, session)
                .queryParam("limit", String.valueOf(limit))
                .queryParam("offset", String.valueOf(offset))
                .header("Authorization", "Bearer " + token);
        if (status != null) request.queryParam("status", status);
        return json(request, expected);
    }

    private void assertCounts(JsonNode page, int open, int answered, int dismissed) {
        assertEquals(open, page.at("/counts/open").asInt());
        assertEquals(answered, page.at("/counts/answered").asInt());
        assertEquals(dismissed, page.at("/counts/dismissed").asInt());
    }

    private void setCreatedAt(UUID questionId, String createdAt) {
        jdbc.sql("update qa.questions set created_at = :createdAt where id = :id")
                .param("createdAt", java.sql.Timestamp.from(Instant.parse(createdAt)))
                .param("id", questionId)
                .update();
    }

    private UUID createSessionInOtherCourse(UUID otherCourseId) throws Exception {
        UUID createdBy = UUID.fromString(personIdOf(adminToken));
        UUID deckId = UuidV7.generate();
        UUID lectureId = UuidV7.generate();
        UUID otherSessionId = UuidV7.generate();
        jdbc.sql("""
                        insert into content.slide_decks
                            (id, course_id, title, version, source_file_ref, source_filename,
                             source_content_type, source_size_bytes)
                        values (:id, :courseId, 'Other deck', 1, 'test', 'other.pdf', 'application/pdf', 0)
                        """)
                .param("id", deckId)
                .param("courseId", otherCourseId)
                .update();
        jdbc.sql("""
                        insert into live.lectures (id, course_id, title, deck_id, created_by)
                        values (:id, :courseId, 'Other lecture', :deckId, :createdBy)
                        """)
                .param("id", lectureId)
                .param("courseId", otherCourseId)
                .param("deckId", deckId)
                .param("createdBy", createdBy)
                .update();
        jdbc.sql("""
                        insert into live.sessions
                            (id, lecture_id, deck_id, status, join_code, started_at, created_by)
                        values (:id, :lectureId, :deckId, 'LIVE', 'FOREIGN1', now(), :createdBy)
                        """)
                .param("id", otherSessionId)
                .param("lectureId", lectureId)
                .param("deckId", deckId)
                .param("createdBy", createdBy)
                .update();
        return otherSessionId;
    }
}
