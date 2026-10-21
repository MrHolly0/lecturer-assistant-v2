package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class QuestionLectureIntegrationTest extends LiveFlowTestBase {
    @Test
    void oneQuestionCanBeReusedWithoutCopiesAndDetachedIndependently() throws Exception {
        String other = lecture("Другая лекция");
        JsonNode question = create(Map.of("lectureIds", List.of(lectureId, lectureId)), 201);
        String id = question.get("id").asText();
        assertEquals(1, question.get("lectureIds").size());
        link(courseId, id, other, lecturerToken, 200);
        assertEquals(2, link(courseId, id, other, lecturerToken, 200).get("lectureIds").size());
        JsonNode list = json(get(path()).header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(1, list.size());
        assertEquals(2, list.get(0).get("lectureIds").size());
        json(delete(path() + "/" + id + "/lectures/" + other)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        json(delete(path() + "/" + id + "/lectures/" + other)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        assertEquals(1, read(id).get("lectureIds").size());
        assertEquals(1L, jdbc.sql("select count(*) from interaction.question_bank").query(Long.class).single());
    }

    @Test
    void legacyEditsPreserveLinksAndExplicitEmptyListUnassigns() throws Exception {
        String id = create(Map.of("lectureIds", List.of(lectureId)), 201).get("id").asText();
        JsonNode legacy = update(id, Map.of("text", "Обновлён"), 200);
        assertEquals(lectureId, legacy.at("/lectureIds/0").asText());
        JsonNode detached = update(id, Map.of("lectureIds", List.of()), 200);
        assertTrue(detached.get("lectureIds").isEmpty());
        assertEquals("Текст вопроса", detached.get("text").asText());
        assertTrue(create(Map.of(), 201).get("lectureIds").isEmpty());
    }

    @Test
    void crossCourseMissingLectureAndInvalidArraysAreAtomicAndScoped() throws Exception {
        String id = create(Map.of("lectureIds", List.of(lectureId)), 201).get("id").asText();
        UUID otherCourse = UUID.fromString(json(post("/api/v1/courses")
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Other course\"}"), 201).get("id").asText());
        String foreign = lecture("Чужая");
        jdbc.sql("update live.lectures set course_id = :course where id = :id")
                .param("course", otherCourse).param("id", UUID.fromString(foreign)).update();
        link(courseId, id, foreign, lecturerToken, 404);
        link(otherCourse, id, foreign, lecturerToken, 404);
        link(courseId, id, UUID.randomUUID().toString(), lecturerToken, 404);
        update(id, Map.of("text", "Не сохранять", "lectureIds", List.of(foreign)), 404);
        assertEquals("Текст вопроса", read(id).get("text").asText());
        assertEquals(lectureId, read(id).at("/lectureIds/0").asText());
        create(Map.of("lectureIds", List.of(foreign)), 404);
        assertEquals(1L, jdbc.sql("select count(*) from interaction.question_bank").query(Long.class).single());
        create(Map.of("lectureIds", java.util.Arrays.asList((Object) null)), 400);
        link(courseId, id, lectureId, maxLogin(77888), 403);
        json(delete(path() + "/" + id + "/lectures/" + lectureId)
                .header("Authorization", "Bearer " + maxLogin(77888)), 403);
    }

    @Test
    void launchingFromAnotherLectureDoesNotRebindAndHistorySurvivesUnlinkAndArchive() throws Exception {
        String other = lecture("Исходная лекция");
        String id = create(Map.of("lectureIds", List.of(other)), 201).get("id").asText();
        JsonNode poll = json(post("/api/v1/courses/{c}/sessions/{s}/polls/from-bank", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionId\":\"" + id + "\"}"), 201);
        assertEquals(other, read(id).at("/lectureIds/0").asText());
        String pollId = poll.at("/poll/id").asText();
        json(post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close", courseId, sessionId, pollId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(delete("/api/v1/courses/{c}/lectures/{l}", courseId, other)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        assertEquals(other, read(id).at("/lectureIds/0").asText());
        json(delete("/api/v1/courses/{c}/lectures/{l}/hard", courseId, other)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        assertTrue(read(id).get("lectureIds").isEmpty());
        update(id, Map.of("text", "Новый текст", "lectureIds", List.of()), 200);
        json(delete(path() + "/" + id).header("Authorization", "Bearer " + lecturerToken), 204);
        JsonNode history = json(get("/api/v1/courses/{c}/sessions/{s}/polls", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals("Текст вопроса", history.at("/items/0/poll/questionText").asText());
        assertFalse(history.toString().contains("Новый текст"));
    }

    private JsonNode read(String id) throws Exception {
        return json(get(path() + "/" + id).header("Authorization", "Bearer " + lecturerToken), 200);
    }

    private JsonNode create(Map<String, Object> extras, int expected) throws Exception {
        return json(post(path()).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content(body(extras)), expected);
    }

    private JsonNode update(String id, Map<String, Object> extras, int expected) throws Exception {
        return json(put(path() + "/" + id).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content(body(extras)), expected);
    }

    private String body(Map<String, Object> extras) throws Exception {
        Map<String, Object> value = new java.util.HashMap<>(Map.of("text", "Текст вопроса",
                "questionType", "SHORT_ANSWER", "options", List.of(), "tags", List.of()));
        value.putAll(extras);
        return objectMapper.writeValueAsString(value);
    }

    private JsonNode link(UUID course, String question, String lecture, String token, int expected) throws Exception {
        return json(put("/api/v1/courses/{c}/questions/{q}/lectures/{l}", course, question, lecture)
                .header("Authorization", "Bearer " + token), expected);
    }

    private String lecture(String title) throws Exception {
        return json(post("/api/v1/courses/{c}/lectures", courseId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("title", title, "deckId", deckId))), 201)
                .get("id").asText();
    }

    private String path() {
        return "/api/v1/courses/" + courseId + "/questions";
    }
}
