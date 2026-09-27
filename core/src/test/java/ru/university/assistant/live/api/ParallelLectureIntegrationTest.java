package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

/** Two teachers can run independent lectures on the same installation. */
class ParallelLectureIntegrationTest extends LiveFlowTestBase {
    @Test
    void teachersRunSeparateCoursesWithoutMixingStudentsOrSignals() throws Exception {
        String invitation = json(post("/api/v1/admin/invitations")
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"role\":\"LECTURER\"}"), 201).get("code").asText();
        String secondTeacher = json(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"invitationCode\":\"" + invitation + "\",\"displayName\":\"Teacher B\","
                        + "\"email\":\"teacher-b@example.test\",\"password\":\"password-123\"}"), 200)
                .get("accessToken").asText();
        UUID secondCourse = UUID.fromString(json(post("/api/v1/courses")
                .header("Authorization", "Bearer " + secondTeacher)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Course B\"}"), 201).get("id").asText());

        byte[] pdf = Files.readAllBytes(Path.of("src/test/resources/golden/content/v1-report.pdf"));
        String jobId = json(multipart("/api/v1/courses/{courseId}/decks", secondCourse)
                .file(new MockMultipartFile("title", "", "text/plain", "Deck B".getBytes()))
                .file(new MockMultipartFile("file", "v1-report.pdf", "application/pdf", pdf))
                .header("Authorization", "Bearer " + secondTeacher), 202).get("id").asText();
        String secondDeck = null;
        for (int i = 0; i < 50 && secondDeck == null; i++) {
            JsonNode job = json(get("/api/v1/courses/{courseId}/import-jobs/{jobId}", secondCourse, jobId)
                    .header("Authorization", "Bearer " + secondTeacher), 200);
            if ("COMPLETED".equals(job.get("status").asText())) secondDeck = job.get("deckId").asText();
            else Thread.sleep(100);
        }
        String secondLecture = json(post("/api/v1/courses/{courseId}/lectures", secondCourse)
                .header("Authorization", "Bearer " + secondTeacher)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Lecture B\",\"deckId\":\"" + secondDeck + "\"}"), 201)
                .get("id").asText();
        JsonNode scheduled = json(post("/api/v1/courses/{courseId}/lectures/{lectureId}/sessions",
                secondCourse, secondLecture)
                .header("Authorization", "Bearer " + secondTeacher)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"groups\":[{\"groupName\":\"Group B\"}]}"), 201);
        UUID secondSession = UUID.fromString(scheduled.get("id").asText());
        String secondCode = scheduled.get("joinCode").asText();
        json(post("/api/v1/courses/{courseId}/sessions/{sessionId}/begin", secondCourse, secondSession)
                .header("Authorization", "Bearer " + secondTeacher), 200);

        assertNotEquals(joinCode, secondCode);
        assertEquals(sessionId.toString(), json(get("/api/v1/me/active-session")
                .header("Authorization", "Bearer " + lecturerToken), 200).get("sessionId").asText());
        assertEquals(secondSession.toString(), json(get("/api/v1/me/active-session")
                .header("Authorization", "Bearer " + secondTeacher), 200).get("sessionId").asText());
        json(get("/api/v1/courses/{courseId}/sessions/{sessionId}", courseId, sessionId)
                .header("Authorization", "Bearer " + secondTeacher), 403);

        JsonNode studentA = join(null, "{\"displayName\":\"Student A\"}");
        JsonNode studentB = json(post("/api/v1/student/sessions/{joinCode}/join", secondCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"displayName\":\"Student B\"}"), 200);
        act("/api/v1/student/sessions/{joinCode}/signals", null,
                "{\"participantToken\":\"" + studentA.get("participantToken").asText()
                        + "\",\"value\":\"RED\"}", 200);
        JsonNode snapshotB = json(get("/api/v1/student/sessions/{joinCode}", secondCode)
                .header("X-Participant-Token", studentB.get("participantToken").asText()), 200);
        assertEquals(0, snapshotB.get("signalAggregate").get("total").asInt());
        assertEquals(1L, count("live.session_participants where session_id = '" + sessionId + "'"));
        assertEquals(1L, count("live.session_participants where session_id = '" + secondSession + "'"));
    }
}
