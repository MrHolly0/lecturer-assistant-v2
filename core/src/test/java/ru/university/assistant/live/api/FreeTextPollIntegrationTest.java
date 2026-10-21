package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class FreeTextPollIntegrationTest extends LiveFlowTestBase {
    @Test
    void textAnswerIsFreeImmutablePrivateAndAvailableInHistoryAndSummary() throws Exception {
        UUID question = question();
        UUID poll = start(question);
        String first = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();
        String second = join(null, "{\"displayName\":\"Борис\"}").get("participantToken").asText();
        JsonNode answer = answer(poll, first, "  Первая строка\nВторая <script>  ", 200);
        assertTrue(answer.get("accepted").asBoolean());
        assertTrue(answer.get("myVote").isNull());
        assertEquals("Первая строка\nВторая <script>", answer.get("myTextAnswer").asText());
        JsonNode duplicate = answer(poll, first, "Не заменять", 200);
        assertFalse(duplicate.get("accepted").asBoolean());
        assertEquals(answer.get("myTextAnswer"), duplicate.get("myTextAnswer"));
        assertEquals(answer.get("myTextAnswer"), snapshot(first).get("myTextAnswer"));
        assertTrue(snapshot(second).get("myTextAnswer").isNull());
        assertTrue(snapshot(null).get("myTextAnswer").isNull());
        assertFalse(snapshot(second).toString().contains("Первая строка"));
        answer(poll, second, "Самостоятельный ответ", 200);

        JsonNode page = answers(poll, lecturerToken, 1, 0, 200);
        assertEquals(2, page.get("total").asInt());
        assertEquals(1, page.get("items").size());
        assertEquals(answer.get("myTextAnswer"), page.at("/items/0/text"));
        assertFalse(page.toString().contains("personId"));
        assertEquals("Самостоятельный ответ", answers(poll, lecturerToken, 1, 1, 200).at("/items/0/text").asText());
        answers(poll, maxLogin(779), 50, 0, 403);
        answers(poll, lecturerToken, 101, 0, 400);
        answers(poll, lecturerToken, 50, -1, 400);

        JsonNode closed = json(post(pollPath(poll) + "/close").header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(2, closed.get("totalResponses").asInt());
        assertTrue(closed.at("/poll/correctOptionIdx").isNull());
        assertTrue(closed.get("votes").isEmpty());
        assertFalse(answer(poll, first, "Поздняя замена", 200).get("accepted").asBoolean());
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        JsonNode summary = json(get("/api/v1/courses/{c}/sessions/{s}/summary", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(2, summary.at("/pollResults/0/totalResponses").asInt());
        assertEquals("SHORT_ANSWER", summary.at("/pollResults/0/questionType").asText());
        assertTrue(summary.at("/pollResults/0/correctOptionIdx").isNull());
        assertEquals(2, answers(poll, lecturerToken, 50, 0, 200).get("total").asInt());
        assertEquals(0L, jdbc.sql("select count(*) from analytics.events where payload::text like '%Первая строка%'")
                .query(Long.class).single());
    }

    @Test
    void textValidationPauseEndAndSessionScopeProtectWrites() throws Exception {
        UUID poll = start(question());
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();
        answer(poll, token, " \n ", 400);
        answer(poll, token, "a".repeat(2001), 400);
        for (Map<String, Object> invalid : java.util.List.of(
                Map.<String, Object>of("participantToken", token),
                Map.<String, Object>of("participantToken", token, "optionIdx", 0),
                Map.<String, Object>of("participantToken", token, "optionIdx", 0, "textAnswer", "оба"))) {
            json(post("/api/v1/student/sessions/{c}/polls/{p}/respond", joinCode, poll)
                    .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(invalid)), 400);
        }
        UUID other = UUID.fromString(startAnotherSession().get("id").asText());
        json(get("/api/v1/courses/{c}/sessions/{s}/polls/{p}/answers", courseId, other, poll)
                .header("Authorization", "Bearer " + lecturerToken), 404);
        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        answer(poll, token, "На паузе", 409);
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        answer(poll, token, "После конца", 409);
        assertEquals(0L, jdbc.sql("select count(*) from interaction.poll_responses").query(Long.class).single());
    }

    @Test
    void legacyShortOptionsAreIgnoredAndNoAutomaticCorrectAnswerCanBeSet() throws Exception {
        UUID question = question();
        jdbc.sql("update interaction.question_bank set options = "
                        + "'[{\"text\":\"Старый эталон\",\"correct\":true}]'::jsonb where id = :id")
                .param("id", question).update();
        UUID poll = start(question);
        json(put(pollPath(poll) + "/correct-option").header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"correctOptionIdx\":0}"), 400);
        json(post(pollPath(poll) + "/close").header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"correctOptionIdx\":0}"), 400);
        assertFalse(snapshot(null).toString().contains("Старый эталон"));
        assertTrue(snapshot(null).at("/activePoll/options").isEmpty());
    }

    @Test
    void deckListProvidesSignedRealFirstSlideThumbnail() throws Exception {
        JsonNode decks = json(get("/api/v1/courses/{c}/decks", courseId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        String thumbnail = decks.get(0).get("thumbnailUrl").asText();
        assertTrue(thumbnail.contains("/slides/1/image?t="));
        assertTrue(thumbnail.contains("&v="));
        mockMvc.perform(get(thumbnail))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
    }

    private UUID question() throws Exception {
        JsonNode value = json(post("/api/v1/courses/{c}/questions", courseId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"Объясните решение\",\"questionType\":\"SHORT_ANSWER\","
                        + "\"options\":[],\"tags\":[]}"), 201);
        assertTrue(value.get("options").isEmpty());
        return UUID.fromString(value.get("id").asText());
    }

    private UUID start(UUID question) throws Exception {
        JsonNode poll = json(post("/api/v1/courses/{c}/sessions/{s}/polls/from-bank", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionId\":\"" + question + "\"}"), 201);
        assertEquals("SHORT_ANSWER", poll.at("/poll/questionType").asText());
        assertTrue(poll.at("/poll/options").isEmpty());
        return UUID.fromString(poll.at("/poll/id").asText());
    }

    private JsonNode answer(UUID poll, String token, String text, int status) throws Exception {
        return json(post("/api/v1/student/sessions/{c}/polls/{p}/respond", joinCode, poll)
                .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(
                        Map.of("participantToken", token, "textAnswer", text))), status);
    }

    private JsonNode snapshot(String token) throws Exception {
        var request = get("/api/v1/student/sessions/{c}", joinCode);
        if (token != null) request.header("X-Participant-Token", token);
        return json(request, 200);
    }

    private JsonNode answers(UUID poll, String jwt, int limit, int offset, int status) throws Exception {
        return json(get(pollPath(poll) + "/answers").header("Authorization", "Bearer " + jwt)
                .queryParam("limit", String.valueOf(limit)).queryParam("offset", String.valueOf(offset)), status);
    }

    private String pollPath(UUID poll) {
        return "/api/v1/courses/" + courseId + "/sessions/" + sessionId + "/polls/" + poll;
    }
}
