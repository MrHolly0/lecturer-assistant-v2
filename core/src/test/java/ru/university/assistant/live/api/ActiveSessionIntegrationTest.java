package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import org.junit.jupiter.api.Test;

/** B-03: GET /api/v1/me/active-session — идущая лекция преподавателя, или 204. */
class ActiveSessionIntegrationTest extends LiveFlowTestBase {

    @Test
    void lecturerWithARunningSessionSeesItsSummary() throws Exception {
        var body = json(get("/api/v1/me/active-session").header("Authorization", "Bearer " + lecturerToken), 200);

        assertEquals(sessionId.toString(), body.get("sessionId").asText());
        assertEquals(courseId.toString(), body.get("courseId").asText());
        assertEquals(joinCode, body.get("joinCode").asText());
        assertEquals("Lecture 1", body.get("lectureTitle").asText());
        assertEquals(groupId.toString(), body.get("groups").get(0).get("id").asText());
        assertEquals(1, body.get("currentSlideIdx").asInt());
    }

    @Test
    void lecturerWithoutARunningSessionGetsNoContent() throws Exception {
        json(post("/api/v1/courses/{c}/sessions/{s}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);

        json(get("/api/v1/me/active-session").header("Authorization", "Bearer " + lecturerToken), 204);
    }

    @Test
    void someoneWithNoSessionsOfTheirOwnGetsNoContent() throws Exception {
        String adminOnlyToken = adminToken; // администратор ничего не запускал

        json(get("/api/v1/me/active-session").header("Authorization", "Bearer " + adminOnlyToken), 204);
    }

    @Test
    void anotherLecturersSessionIsNotReturned() throws Exception {
        String invite = json(post("/api/v1/admin/invitations")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"LECTURER\"}"), 201)
                .get("code")
                .asText();
        String otherLecturerToken = json(post("/api/v1/auth/register")
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"invitationCode\":\"" + invite + "\",\"displayName\":\"Other\","
                                + "\"email\":\"other@example.test\",\"password\":\"password-123\"}"), 200)
                .get("accessToken")
                .asText();

        json(get("/api/v1/me/active-session").header("Authorization", "Bearer " + otherLecturerToken), 204);
    }
}
