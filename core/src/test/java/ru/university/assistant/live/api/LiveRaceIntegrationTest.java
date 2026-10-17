package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class LiveRaceIntegrationTest extends LiveFlowTestBase {
    @Test
    void endingSessionWinsAgainstConcurrentPauseAndResume() throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            Future<Integer> ending = executor.submit(() -> {
                ready.countDown();
                await(start);
                return mockMvc.perform(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                                .header("Authorization", "Bearer " + lecturerToken))
                        .andReturn().getResponse().getStatus();
            });
            Future<int[]> pausingAndResuming = executor.submit(() -> {
                ready.countDown();
                await(start);
                int paused = mockMvc.perform(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                                .header("Authorization", "Bearer " + lecturerToken))
                        .andReturn().getResponse().getStatus();
                int resumed = paused == 200
                        ? mockMvc.perform(post("/api/v1/courses/{c}/sessions/{s}/resume", courseId, sessionId)
                                        .header("Authorization", "Bearer " + lecturerToken))
                                .andReturn().getResponse().getStatus()
                        : 0;
                return new int[] {paused, resumed};
            });
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            assertEquals(200, ending.get(10, TimeUnit.SECONDS));
            int[] transitions = pausingAndResuming.get(10, TimeUnit.SECONDS);
            assertTrue(transitions[0] == 200 || transitions[0] == 409);
            assertTrue(transitions[1] == 0 || transitions[1] == 200 || transitions[1] == 409);
        }
        assertEquals("ENDED", jdbc.sql("select status from live.sessions where id = :id")
                .param("id", sessionId).query(String.class).single());
        assertEquals(1L, count("live.sessions where id = '" + sessionId + "' and ended_at is not null"));
    }

    @Test
    void pollCloseAndResponseRaceLeavesClosedVoteCountImmutable() throws Exception {
        String studentJwt = maxLogin(98801);
        String participantToken = join(studentJwt, "{}").get("participantToken").asText();
        UUID pollId = startPoll();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        long closedVoteCount;
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            Future<JsonNode> close = executor.submit(() -> {
                ready.countDown();
                await(start);
                return json(post("/api/v1/courses/{c}/sessions/{s}/polls/{p}/close", courseId, sessionId, pollId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"), 200);
            });
            Future<JsonNode> respond = executor.submit(() -> {
                ready.countDown();
                await(start);
                return json(post("/api/v1/student/sessions/{code}/polls/{poll}/respond", joinCode, pollId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"participantToken\":\"" + participantToken + "\",\"optionIdx\":1}"), 200);
            });
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            JsonNode closed = close.get(10, TimeUnit.SECONDS);
            JsonNode response = respond.get(10, TimeUnit.SECONDS);
            assertEquals("CLOSED", closed.at("/poll/status").asText());

            long storedVotes = count("interaction.poll_responses where poll_id = '" + pollId + "'");
            assertEquals(response.get("accepted").asBoolean() ? 1 : 0, storedVotes);
            assertEquals(storedVotes, closed.get("totalResponses").asLong());
            closedVoteCount = storedVotes;
        }

        JsonNode late = json(post("/api/v1/student/sessions/{code}/polls/{poll}/respond", joinCode, pollId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + participantToken + "\",\"optionIdx\":0}"), 200);
        assertTrue(!late.get("accepted").asBoolean());
        assertEquals(closedVoteCount, count("interaction.poll_responses where poll_id = '" + pollId + "'"));
    }

    private UUID startPoll() throws Exception {
        JsonNode result = json(post("/api/v1/courses/{c}/sessions/{s}/polls", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Race?\",\"options\":[\"A\",\"B\"]}"), 201);
        return UUID.fromString(result.get("poll").get("id").asText());
    }

    private static void await(CountDownLatch start) throws InterruptedException {
        if (!start.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Race start signal timed out");
    }
}
