package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import ru.university.assistant.shared.api.UuidV7;

class SessionHistoryIntegrationTest extends LiveFlowTestBase {

    @Test
    void emptyHistoryDoesNotIncludeActiveSession() throws Exception {
        JsonNode history = history(courseId, lecturerToken, 20, 0, 200);

        assertEquals(0, history.get("total").asInt());
        assertEquals(0, history.get("items").size());
    }

    @Test
    void historyIsPaginatedScopedAndKeepsRepeatedLecturePollResults() throws Exception {
        UUID firstSessionId = sessionId;
        UUID pollId = startAndClosePoll(firstSessionId);
        end(firstSessionId);

        JsonNode repeated = json(post("/api/v1/courses/{c}/lectures/{l}/sessions", courseId, lectureId)
                .header("Authorization", "Bearer " + lecturerToken), 201);
        UUID secondSessionId = UUID.fromString(repeated.get("id").asText());
        end(secondSessionId);

        JsonNode active = json(post("/api/v1/courses/{c}/lectures/{l}/sessions", courseId, lectureId)
                .header("Authorization", "Bearer " + lecturerToken), 201);
        UUID activeSessionId = UUID.fromString(active.get("id").asText());
        UUID otherCourseSessionId = createCompletedSessionInAnotherCourse();

        jdbc.sql("update live.sessions set ended_at = now() - interval '2 hours' where id = :id")
                .param("id", firstSessionId)
                .update();
        jdbc.sql("update live.sessions set ended_at = now() - interval '1 hour' where id = :id")
                .param("id", secondSessionId)
                .update();

        JsonNode firstPage = history(courseId, lecturerToken, 1, 0, 200);
        assertEquals(2, firstPage.get("total").asInt());
        assertEquals(1, firstPage.get("items").size());
        assertEquals(secondSessionId.toString(), firstPage.get("items").get(0).get("id").asText());
        assertEquals(lectureId.toString(), firstPage.get("items").get(0).get("lectureId").asText());
        assertEquals("ENDED", firstPage.get("items").get(0).get("status").asText());

        JsonNode secondPage = history(courseId, lecturerToken, 1, 1, 200);
        assertEquals(firstSessionId.toString(), secondPage.get("items").get(0).get("id").asText());
        assertEquals(lectureId.toString(), secondPage.get("items").get(0).get("lectureId").asText());
        assertFalse(secondPage.toString().contains(activeSessionId.toString()));
        assertFalse(secondPage.toString().contains(otherCourseSessionId.toString()));

        JsonNode summary = json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, firstSessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(1, summary.get("pollResults").size());
        assertEquals(pollId.toString(), summary.get("pollResults").get(0).get("pollId").asText());
    }

    @Test
    void historyRequiresCourseManagementAndValidPagination() throws Exception {
        String studentJwt = maxLogin(818);

        history(courseId, studentJwt, 20, 0, 403);
        history(courseId, lecturerToken, 0, 0, 400);
        history(courseId, lecturerToken, 101, 0, 400);
        history(courseId, lecturerToken, 20, -1, 400);
    }

    private JsonNode history(UUID course, String token, int limit, int offset, int expected) throws Exception {
        return json(get("/api/v1/courses/{c}/sessions", course)
                .queryParam("limit", String.valueOf(limit))
                .queryParam("offset", String.valueOf(offset))
                .header("Authorization", "Bearer " + token), expected);
    }

    private UUID startAndClosePoll(UUID session) throws Exception {
        JsonNode started = json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, session)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Что сохранилось?\",\"options\":[\"A\",\"B\"]}"), 201);
        UUID pollId = UUID.fromString(started.get("poll").get("id").asText());
        json(post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close", courseId, session, pollId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"correctOptionIdx\":0}"), 200);
        return pollId;
    }

    private void end(UUID session) throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, session)
                .header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private UUID createCompletedSessionInAnotherCourse() throws Exception {
        UUID otherCourseId = UUID.fromString(json(post("/api/v1/courses")
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Other course\"}"), 201)
                .get("id")
                .asText());
        UUID createdBy = UUID.fromString(personIdOf(lecturerToken));
        UUID otherDeckId = UuidV7.generate();
        UUID otherLectureId = UuidV7.generate();
        UUID otherSessionId = UuidV7.generate();
        jdbc.sql("""
                        insert into content.slide_decks
                            (id, course_id, title, version, source_file_ref, source_filename,
                             source_content_type, source_size_bytes)
                        values (:id, :courseId, 'Other deck', 1, 'test', 'other.pdf', 'application/pdf', 0)
                        """)
                .param("id", otherDeckId)
                .param("courseId", otherCourseId)
                .update();
        jdbc.sql("""
                        insert into live.lectures (id, course_id, title, deck_id, created_by)
                        values (:id, :courseId, 'Other lecture', :deckId, :createdBy)
                        """)
                .param("id", otherLectureId)
                .param("courseId", otherCourseId)
                .param("deckId", otherDeckId)
                .param("createdBy", createdBy)
                .update();
        jdbc.sql("""
                        insert into live.sessions
                            (id, lecture_id, status, join_code, started_at, ended_at, created_by)
                        values (:id, :lectureId, 'ENDED', 'OTHER1', now() - interval '1 hour', now(), :createdBy)
                        """)
                .param("id", otherSessionId)
                .param("lectureId", otherLectureId)
                .param("createdBy", createdBy)
                .update();
        return otherSessionId;
    }
}
