package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

class QuestionAnswerVisibilityIntegrationTest extends LiveFlowTestBase {

    @Test
    void privateAnswerIsVisibleOnlyToAuthenticatedAuthorAcrossSnapshotAndSse() throws Exception {
        String author = maxLogin(9301);
        String peer = maxLogin(9302);
        String authorParticipantToken = join(author, null).get("participantToken").asText();
        String peerParticipantToken = join(peer, null).get("participantToken").asText();
        UUID questionId = askWithJwt(author, "Можно повторить определение?");
        MvcResult authorEvents = events(authorParticipantToken);
        MvcResult peerEvents = events(peerParticipantToken);

        answer(questionId, "private-answer-9301", "AUTHOR", 200);

        JsonNode authorSnapshot = snapshotWithJwt(author);
        assertEquals(1, authorSnapshot.get("questionAnswers").size());
        assertEquals("private-answer-9301",
                authorSnapshot.at("/questionAnswers/0/answerText").asText());
        assertEquals(0, snapshotWithJwt(peer).get("questionAnswers").size());
        assertEquals(0, snapshotAnonymous().get("questionAnswers").size());
        assertTrue(awaitContent(authorEvents, "private-answer-9301"));
        assertFalse(awaitContent(peerEvents, "private-answer-9301"));
    }

    @Test
    void guestPrivateAnswerSurvivesReconnectAndSessionAnswerIsAnonymous() throws Exception {
        JsonNode authorJoin = join(null, "{\"displayName\":\"Гость один\"}");
        JsonNode peerJoin = join(null, "{\"displayName\":\"Гость два\"}");
        String authorToken = authorJoin.get("participantToken").asText();
        String peerToken = peerJoin.get("participantToken").asText();

        UUID privateQuestion = askWithToken(authorToken, "Где найти формулу?");
        answer(privateQuestion, "В приложенных материалах.", "AUTHOR", 200);
        assertEquals(1, snapshotWithToken(authorToken).get("questionAnswers").size());
        assertEquals(0, snapshotWithToken(peerToken).get("questionAnswers").size());

        MvcResult authorEvents = events(authorToken);
        MvcResult peerEvents = events(peerToken);
        UUID publicQuestion = askWithToken(peerToken, "Что нужно запомнить всем?");
        JsonNode publicAnswer = answer(publicQuestion, "session-answer-all", "SESSION", 200);
        assertEquals("SESSION", publicAnswer.get("answerVisibility").asText());
        assertTrue(awaitContent(authorEvents, "session-answer-all"));
        assertTrue(awaitContent(peerEvents, "session-answer-all"));

        JsonNode anonymous = snapshotAnonymous();
        assertEquals(1, anonymous.get("questionAnswers").size());
        JsonNode safeAnswer = anonymous.get("questionAnswers").get(0);
        assertEquals("Что нужно запомнить всем?", safeAnswer.get("questionText").asText());
        assertEquals("session-answer-all", safeAnswer.get("answerText").asText());
        assertFalse(safeAnswer.has("displayName"));
        assertFalse(safeAnswer.has("personId"));
        assertEquals(2, snapshotWithToken(authorToken).get("questionAnswers").size());
        assertEquals(1, snapshotWithToken(peerToken).get("questionAnswers").size());
    }

    @Test
    void answerRequiresExplicitVisibilityAndRunningSession() throws Exception {
        String author = maxLogin(9303);
        join(author, null);
        UUID questionId = askWithJwt(author, "Нужна видимость");

        json(put("/api/v1/courses/{course}/sessions/{session}/questions/{question}",
                        courseId, sessionId, questionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"ANSWERED\",\"answerText\":\"Ответ\"}"), 400);
        json(put("/api/v1/courses/{course}/sessions/{session}/questions/{question}",
                        courseId, sessionId, questionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"DISMISSED\",\"answerVisibility\":\"SESSION\"}"), 400);

        json(post("/api/v1/courses/{course}/sessions/{session}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        answer(questionId, "Поздний ответ", "AUTHOR", 409);
    }

    private UUID askWithJwt(String jwt, String text) throws Exception {
        return UUID.fromString(json(post("/api/v1/student/sessions/{code}/questions", joinCode)
                        .header("Authorization", "Bearer " + jwt)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(java.util.Map.of("text", text))), 201)
                .get("id")
                .asText());
    }

    private UUID askWithToken(String participantToken, String text) throws Exception {
        return UUID.fromString(json(post("/api/v1/student/sessions/{code}/questions", joinCode)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(java.util.Map.of(
                                "text", text, "participantToken", participantToken))), 201)
                .get("id")
                .asText());
    }

    private JsonNode answer(UUID questionId, String answerText, String visibility, int expected) throws Exception {
        return json(put("/api/v1/courses/{course}/sessions/{session}/questions/{question}",
                        courseId, sessionId, questionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(java.util.Map.of(
                        "status", "ANSWERED",
                        "answerText", answerText,
                        "answerVisibility", visibility))), expected);
    }

    private JsonNode snapshotWithJwt(String jwt) throws Exception {
        return json(get("/api/v1/student/sessions/{code}", joinCode)
                .header("Authorization", "Bearer " + jwt), 200);
    }

    private JsonNode snapshotWithToken(String participantToken) throws Exception {
        return json(get("/api/v1/student/sessions/{code}", joinCode)
                .header("X-Participant-Token", participantToken), 200);
    }

    private JsonNode snapshotAnonymous() throws Exception {
        return json(get("/api/v1/student/sessions/{code}", joinCode), 200);
    }

    private MvcResult events(String participantToken) throws Exception {
        return mockMvc.perform(get("/api/v1/student/sessions/{code}/events", joinCode)
                        .queryParam("participantToken", participantToken))
                .andExpect(request().asyncStarted())
                .andReturn();
    }

    private boolean awaitContent(MvcResult result, String expected) throws Exception {
        for (int attempt = 0; attempt < 20; attempt++) {
            if (result.getResponse().getContentAsString().contains(expected)) {
                return true;
            }
            Thread.sleep(25);
        }
        return false;
    }
}
