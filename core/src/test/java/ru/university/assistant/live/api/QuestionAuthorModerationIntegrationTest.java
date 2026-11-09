package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class QuestionAuthorModerationIntegrationTest extends LiveFlowTestBase {
    @Autowired PlatformTransactionManager transactions;

    @Test
    void anonymousMuteHidesIdentityBlocksBothKindsOfQuestionsButAllowsLearning() throws Exception {
        String author = maxLogin(97001);
        join(author, null);
        String person = personIdOf(author);
        JsonNode question = ask(author, null, true, "Первый вопрос", 201);
        JsonNode result = moderate(question.get("id").asText(), lecturerToken, true, false, 200);
        assertEquals(2, result.size());
        assertTrue(result.get("muted").asBoolean());
        assertFalse(result.toString().contains(person));
        assertEquals(0, result.get("hiddenQuestions").asInt());
        ask(author, null, false, "С именем", 403);
        ask(author, null, true, "Анонимно", 403);
        assertTrue(snapshot(author, null).get("questionPostingMuted").asBoolean());
        assertFalse(snapshot(null, null).get("questionPostingMuted").asBoolean());
        assertFalse(snapshot(author, null).get("currentSlide").isNull());
        act("/api/v1/student/sessions/{code}/signals", author, "{\"value\":\"GREEN\"}", 200);
        assertEquals(1, count("qa.questions"));
        JsonNode staff = json(get("/api/v1/courses/{course}/sessions/{session}/questions", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertFalse(staff.toString().contains(person));
        assertEquals("Анонимный вопрос", staff.at("/items/0/displayName").asText());
    }

    @Test
    void muteSurvivesRejoinTokenRotationAndNewSessionIsIndependent() throws Exception {
        String author = maxLogin(97002);
        join(author, null);
        JsonNode question = ask(author, null, false, "Вопрос", 201);
        moderate(question.get("id").asText(), lecturerToken, true, false, 200);
        JsonNode rejoined = join(author, null);
        assertTrue(rejoined.at("/snapshot/questionPostingMuted").asBoolean());
        ask(null, rejoined.get("participantToken").asText(), false, "Из другого подключения", 403);
        JsonNode other = startAnotherSession();
        json(post("/api/v1/student/sessions/{code}/join", other.get("joinCode").asText())
                .header("Authorization", "Bearer " + author), 200);
        json(post("/api/v1/student/sessions/{code}/questions", other.get("joinCode").asText())
                .header("Authorization", "Bearer " + author).contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"На другом занятии\"}"), 201);
    }

    @Test
    void clearOnlyThisAuthorInThisSessionAndKeepOriginalsInRestrictedAudit() throws Exception {
        String author = maxLogin(97003);
        String other = maxLogin(97004); // The same self-reported name is not an identity.
        join(author, null);
        join(other, null);
        String first = ask(author, null, false, "Первый", 201).get("id").asText();
        String second = ask(author, null, true, "Второй", 201).get("id").asText();
        ask(other, null, false, "Чужой вопрос", 201);
        json(put("/api/v1/courses/{course}/sessions/{session}/questions/{question}", courseId, sessionId, first)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"ANSWERED\",\"answerText\":\"Ответ\",\"answerVisibility\":\"SESSION\"}"), 200);
        assertEquals(1, snapshot(other, null).get("questionAnswers").size());
        JsonNode result = moderate(second, lecturerToken, true, true, 200);
        assertEquals(2, result.get("hiddenQuestions").asInt());
        assertEquals(2, count("qa.questions where status = 'DISMISSED'"));
        assertEquals(1, count("qa.questions where status = 'OPEN'"));
        assertEquals(0, snapshot(other, null).get("questionAnswers").size());
        assertTrue(jdbc.sql("select hidden_questions::text from qa.author_moderation_log")
                .query(String.class).single().contains("Ответ"));
        assertEquals(0, moderate(second, lecturerToken, true, true, 200).get("hiddenQuestions").asInt());
        assertEquals(1, count("qa.author_moderation_log"));
        assertEquals(1, count("analytics.events where verb = 'qa.author_moderated'"));
        ask(other, null, false, "Другой участник пишет", 201);
        moderate(second, lecturerToken, false, false, 200);
        assertFalse(snapshot(author, null).get("questionPostingMuted").asBoolean());
        ask(author, null, false, "После отмены", 201);
        assertEquals(2, count("qa.questions where status = 'DISMISSED'"));
    }

    @Test
    void guestCannotEscapeMuteByClaimingTheirParticipationWithAnAccount() throws Exception {
        String guest = join(null, "{\"displayName\":\"Гость с именем\"}").get("participantToken").asText();
        String question = ask(null, guest, true, "От гостя", 201).get("id").asText();
        moderate(question, lecturerToken, true, false, 200);
        String profile = maxLogin(97005);
        JsonNode claimed = join(profile, objectMapper.writeValueAsString(Map.of("participantToken", guest)));
        assertTrue(claimed.at("/snapshot/questionPostingMuted").asBoolean());
        ask(profile, null, false, "После входа", 403);
        moderate(question, lecturerToken, false, false, 200);
        ask(profile, null, false, "После отмены", 201);
    }

    @Test
    void checksManagementScopeRequestAndSessionLifecycle() throws Exception {
        String author = maxLogin(97006);
        join(author, null);
        String question = ask(author, null, true, "Вопрос", 201).get("id").asText();
        moderate(question, author, true, false, 403);
        moderate(UUID.randomUUID().toString(), lecturerToken, true, false, 404);
        moderate(question, lecturerToken, false, true, 400);
        json(put(moderationPath(question)).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content("{}"), 400);
        JsonNode other = startAnotherSession();
        json(put("/api/v1/courses/{course}/sessions/{session}/questions/{question}/author-moderation",
                        courseId, other.get("id").asText(), question)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"muted\":true}"), 404);
        json(post("/api/v1/courses/{course}/sessions/{session}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        moderate(question, lecturerToken, true, false, 200);
        json(post("/api/v1/courses/{course}/sessions/{session}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertFalse(snapshot(author, null).get("questionPostingMuted").asBoolean());
        moderate(question, lecturerToken, false, false, 409);
    }

    @Test
    void queuedQuestionCannotSlipThroughAfterModerationCommits() throws Exception {
        String author = maxLogin(97007);
        join(author, null);
        String question = ask(author, null, false, "До ограничения", 201).get("id").asText();
        CountDownLatch started = new CountDownLatch(1);
        CompletableFuture<Void> queued = new TransactionTemplate(transactions).execute(status -> {
            jdbc.sql("select id from live.sessions where id = :session for update")
                    .param("session", sessionId).query(UUID.class).single();
            CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
                started.countDown();
                try { ask(author, null, true, "Одновременно с запретом", 403); }
                catch (Exception exception) { throw new IllegalStateException(exception); }
            });
            try {
                assertTrue(started.await(5, TimeUnit.SECONDS));
                moderate(question, lecturerToken, true, true, 200);
            } catch (Exception exception) { throw new IllegalStateException(exception); }
            return future;
        });
        queued.get(10, TimeUnit.SECONDS);
        assertEquals(1, count("qa.questions"));
        assertEquals(0, count("qa.questions where status = 'OPEN'"));
    }

    private JsonNode snapshot(String author, String participantToken) throws Exception {
        var request = get("/api/v1/student/sessions/{code}", joinCode);
        if (author != null) request.header("Authorization", "Bearer " + author);
        if (participantToken != null) request.header("X-Participant-Token", participantToken);
        return json(request, 200);
    }

    private JsonNode ask(String author, String participantToken, boolean anonymous, String text, int status)
            throws Exception {
        var request = post("/api/v1/student/sessions/{code}/questions", joinCode)
                .contentType(MediaType.APPLICATION_JSON);
        if (author != null) request.header("Authorization", "Bearer " + author);
        Map<String, Object> body = new java.util.HashMap<>(Map.of("text", text, "anonymous", anonymous));
        if (participantToken != null) body.put("participantToken", participantToken);
        return json(request.content(objectMapper.writeValueAsString(body)), status);
    }

    private String moderationPath(String question) {
        return "/api/v1/courses/" + courseId + "/sessions/" + sessionId + "/questions/" + question
                + "/author-moderation";
    }

    private JsonNode moderate(String question, String actor, boolean muted, boolean hide, int status) throws Exception {
        return json(put(moderationPath(question)).header("Authorization", "Bearer " + actor)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("muted", muted, "hideQuestions", hide))), status);
    }
}
