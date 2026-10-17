package ru.university.assistant.live.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class StudentAccessRevocationIntegrationTest extends LiveFlowTestBase {
    @Test
    void courseBanRejectsRejoinSnapshotAndInteractionsForExistingParticipant() throws Exception {
        String studentJwt = maxLogin(98701);
        String participantToken = join(studentJwt, "{}").get("participantToken").asText();
        UUID personId = UUID.fromString(personIdOf(studentJwt));
        UUID pollId = startPoll();

        json(post("/api/v1/courses/{courseId}/bans", courseId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"personId\":\"" + personId + "\",\"reason\":\"course policy\"}"), 201);

        json(get("/api/v1/courses/{courseId}", courseId)
                .header("Authorization", "Bearer " + studentJwt), 403);
        json(get("/api/v1/student/sessions/{joinCode}", joinCode)
                .header("X-Participant-Token", participantToken), 403);
        json(post("/api/v1/student/sessions/{joinCode}/join", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + participantToken + "\"}"), 403);
        json(post("/api/v1/student/sessions/{joinCode}/polls/{pollId}/respond", joinCode, pollId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + participantToken + "\",\"optionIdx\":0}"), 403);
    }

    @Test
    void disableRoleChangeAndPasswordChangeInvalidateExistingProfileParticipantTokens() throws Exception {
        RegisteredStudent disabled = registerStudent("participant-disabled@example.test");
        String disabledParticipant = join(disabled.accessToken(), "{}").get("participantToken").asText();
        json(put("/api/v1/admin/users/{personId}/status", disabled.personId())
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"DISABLED\"}"), 200);
        assertParticipantTokenRevoked(disabledParticipant);

        RegisteredStudent roleChanged = registerStudent("participant-role@example.test");
        String roleParticipant = join(roleChanged.accessToken(), "{}").get("participantToken").asText();
        json(put("/api/v1/admin/users/{personId}/role", roleChanged.personId())
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"role\":\"LECTURER\"}"), 200);
        assertParticipantTokenRevoked(roleParticipant);

        RegisteredStudent passwordChanged = registerStudent("participant-password@example.test");
        String passwordParticipant = join(passwordChanged.accessToken(), "{}").get("participantToken").asText();
        json(post("/api/v1/auth/change-password")
                .header("Authorization", "Bearer " + passwordChanged.accessToken())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"password-123\",\"newPassword\":\"password-456\"}"), 204);
        assertParticipantTokenRevoked(passwordParticipant);
    }

    private RegisteredStudent registerStudent(String email) throws Exception {
        JsonNode invitation = json(post("/api/v1/courses/{courseId}/invitations", courseId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"role\":\"STUDENT\",\"groupId\":\"" + groupId + "\"}"), 201);
        JsonNode registered = json(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"invitationCode\":\"" + invitation.get("code").asText()
                        + "\",\"displayName\":\"Credential Student\",\"email\":\"" + email
                        + "\",\"password\":\"password-123\"}"), 200);
        return new RegisteredStudent(
                registered.get("accessToken").asText(), UUID.fromString(registered.at("/user/id").asText()));
    }

    private void assertParticipantTokenRevoked(String participantToken) throws Exception {
        json(get("/api/v1/student/sessions/{joinCode}", joinCode)
                .header("X-Participant-Token", participantToken), 401);
        json(post("/api/v1/student/sessions/{joinCode}/signals", joinCode)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"participantToken\":\"" + participantToken + "\",\"value\":\"RED\"}"), 401);
        json(get("/api/v1/student/sessions/{joinCode}/events", joinCode)
                .queryParam("participantToken", participantToken), 401);
    }

    private record RegisteredStudent(String accessToken, UUID personId) {}

    private UUID startPoll() throws Exception {
        JsonNode result = json(post("/api/v1/courses/{courseId}/sessions/{sessionId}/polls", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionText\":\"Pick one\",\"options\":[\"A\",\"B\"]}"), 201);
        return UUID.fromString(result.get("poll").get("id").asText());
    }
}
