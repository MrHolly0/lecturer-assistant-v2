package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import ru.university.assistant.projection.api.FrameFixture;

/** HTTP identity and revocation checks, using actual participant receipts and database membership. */
class ShareIntegrationTest extends LiveFlowTestBase {
    private static final String OFFER = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n";
    private static final String ANSWER = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n";

    @Test
    void anonymousCodeAndAuthenticatedNonParticipantCannotJoinMediaOrImplicitlyRejoin() throws Exception {
        UUID viewer = UUID.randomUUID();
        JsonNode share = startShare();
        long before = count("live.session_participants");
        json(get(viewerPath(viewer)), 401);
        json(put(viewerPath(viewer) + "/" + share.get("id").asText())
                .contentType(MediaType.APPLICATION_JSON).content(sdp(ANSWER)), 401);
        String unjoined = maxLogin(831001);
        json(get(viewerPath(viewer)).header("Authorization", "Bearer " + unjoined), 403);
        assertEquals(before, count("live.session_participants"));
        json(post(staffPath()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"sourceName\":\"Window\"}"), 401);
        json(post(staffPath()).header("Authorization", "Bearer " + unjoined)
                .contentType(MediaType.APPLICATION_JSON).content("{\"sourceName\":\"Window\"}"), 403);
    }

    @Test
    void guestAndProfileSignallingAreBoundToTheActualPersonAndSession() throws Exception {
        JsonNode share = startShare();
        String shareId = share.get("id").asText();
        String profile = maxLogin(831002);
        String receipt = join(profile, "{}").get("participantToken").asText();
        UUID viewer = UUID.randomUUID();
        JsonNode registration = json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 200);
        assertEquals(shareId, registration.get("id").asText());
        assertTrue(registration.get("offer").isNull());
        json(put(staffPath() + "/" + shareId + "/viewers/" + viewer)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content(sdp(OFFER)), 204);
        assertEquals(OFFER, json(get(viewerPath(viewer))
                .header("Authorization", "Bearer " + profile), 200).get("offer").asText());
        String stranger = maxLogin(831003);
        join(stranger, "{}");
        json(get(viewerPath(viewer)).header("Authorization", "Bearer " + stranger), 403);
        json(put(viewerPath(viewer) + "/" + shareId).header("Authorization", "Bearer " + stranger)
                .contentType(MediaType.APPLICATION_JSON).content(sdp(ANSWER)), 403);
        json(put(viewerPath(viewer) + "/" + shareId).header("X-Participant-Token", receipt)
                .contentType(MediaType.APPLICATION_JSON).content(sdp(ANSWER)), 204);
        JsonNode polled = json(get(staffPath() + "/" + shareId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(ANSWER, polled.get("peers").get(0).get("answer").asText());
        assertFalse(polled.toString().contains(receipt));
        JsonNode otherSession = startAnotherSession();
        json(get("/api/v1/student/sessions/{code}/screen-share/viewers/{viewer}",
                        otherSession.get("joinCode").asText(), UUID.randomUUID())
                .header("X-Participant-Token", receipt), 401);
    }

    @Test
    void kickingAndCourseBanRevokeMediaWithoutReadRegisteringTheViewerAgain() throws Exception {
        JsonNode share = startShare();
        String jwt = maxLogin(831004);
        String receipt = join(jwt, "{}").get("participantToken").asText();
        String person = personIdOf(jwt);
        UUID viewer = UUID.randomUUID();
        json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 200);
        json(post("/api/v1/courses/{course}/sessions/{session}/participants/{person}/kick",
                        courseId, sessionId, person)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        long rows = count("live.session_participants");
        json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 403);
        json(get(viewerPath(viewer)).header("Authorization", "Bearer " + jwt), 403);
        json(put(viewerPath(viewer) + "/" + share.get("id").asText())
                .header("Authorization", "Bearer " + jwt)
                .contentType(MediaType.APPLICATION_JSON).content(sdp(ANSWER)), 403);
        assertEquals(rows, count("live.session_participants"));
        String rejoinedReceipt = join(jwt, "{}").get("participantToken").asText();
        json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 401);
        json(get(viewerPath(viewer)).header("Authorization", "Bearer " + jwt), 200);
        json(post("/api/v1/courses/{course}/bans", courseId)
                .header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("personId", person, "reason", "Test"))), 201);
        json(get(viewerPath(viewer)).header("Authorization", "Bearer " + jwt), 403);
        json(get(viewerPath(viewer)).header("X-Participant-Token", rejoinedReceipt), 403);
    }

    @Test
    void disablingProfileInvalidatesBothJwtAndPreviouslyIssuedParticipantReceipt() throws Exception {
        startShare();
        String jwt = maxLogin(831005);
        String receipt = join(jwt, "{}").get("participantToken").asText();
        UUID viewer = UUID.randomUUID();
        json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 200);
        json(put("/api/v1/admin/users/{person}/status", personIdOf(jwt))
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DISABLED\"}"), 200);
        json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 401);
        json(get(viewerPath(viewer)).header("Authorization", "Bearer " + jwt), 401);
    }

    @Test
    void sourceAndSdpValidationAndWrongCourseScopeAreEnforcedAtHttpBoundary() throws Exception {
        for (String name : new String[] { "", " ", "x".repeat(121) }) {
            json(post(staffPath()).header("Authorization", "Bearer " + lecturerToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("sourceName", name))), 400);
        }
        JsonNode share = startShare();
        String id = share.get("id").asText();
        String jwt = maxLogin(831006);
        String receipt = join(jwt, "{}").get("participantToken").asText();
        UUID viewer = UUID.randomUUID();
        json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 200);
        for (String value : new String[] { "", "v=0\r\nm=audio", OFFER + "x".repeat(65537) }) {
            json(put(staffPath() + "/" + id + "/viewers/" + viewer)
                    .header("Authorization", "Bearer " + lecturerToken)
                    .contentType(MediaType.APPLICATION_JSON).content(sdp(value)), 400);
        }
        json(get("/api/v1/courses/{course}/sessions/{session}/screen-share/{share}",
                        UUID.randomUUID(), sessionId, id)
                .header("Authorization", "Bearer " + lecturerToken), 403);
        json(delete(staffPath() + "/" + UUID.randomUUID())
                .header("Authorization", "Bearer " + lecturerToken), 409);
        json(delete(staffPath() + "/" + id)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 204);
        json(put(viewerPath(viewer) + "/" + id).header("X-Participant-Token", receipt)
                .contentType(MediaType.APPLICATION_JSON).content(sdp(ANSWER)), 410);
    }

    @Test
    void httpsFramesAreBoundedOwnerOnlyAndRequireCurrentRegisteredParticipant() throws Exception {
        JsonNode share = startShare();
        String frameUpload = staffPath() + "/" + share.get("id").asText() + "/frame";
        String jwt = maxLogin(831101);
        String receipt = join(jwt, "{}").get("participantToken").asText();
        UUID viewer = UUID.randomUUID();
        String frame = viewerPath(viewer) + "/frame";
        json(get(frame), 401);
        json(get(frame).header("X-Participant-Token", receipt), 404);
        json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 200);
        json(get(frame).header("X-Participant-Token", receipt), 204);
        byte[] jpeg = FrameFixture.jpeg(1920, 1080);
        json(put(frameUpload).header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.IMAGE_JPEG).content(jpeg), 403);
        json(put(frameUpload).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_PNG).content(jpeg), 415);
        json(put(frameUpload).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_JPEG).content(new byte[256 * 1024 + 1]), 413);
        json(put(frameUpload).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_JPEG).content(FrameFixture.jpeg(1921, 1080)), 400);
        json(put(frameUpload).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_JPEG).content(FrameFixture.jpeg(1920, 1081)), 400);
        json(put(frameUpload).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_JPEG).content(jpeg), 204);
        mockMvc.perform(get(frame).header("X-Participant-Token", receipt))
                .andExpect(status().isOk()).andExpect(content().contentType(MediaType.IMAGE_JPEG))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(content().bytes(jpeg));
        json(put(frameUpload).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_JPEG).content(jpeg), 429);
        String stranger = maxLogin(831102);
        String strangerReceipt = join(stranger, "{}").get("participantToken").asText();
        json(get(frame).header("X-Participant-Token", strangerReceipt), 403);
        json(post("/api/v1/courses/{course}/sessions/{session}/participants/{person}/kick",
                courseId, sessionId, personIdOf(jwt)).header("Authorization", "Bearer " + lecturerToken), 200);
        json(get(frame).header("X-Participant-Token", receipt), 403);
        json(delete(staffPath() + "/" + share.get("id").asText())
                .header("Authorization", "Bearer " + lecturerToken), 204);
        json(get(frame).header("X-Participant-Token", strangerReceipt), 204);
    }

    @Test
    void pauseAndStopDiscardFrameInsteadOfReplayingItAfterResume() throws Exception {
        JsonNode share = startShare();
        String receipt = join(maxLogin(831103), "{}").get("participantToken").asText();
        UUID viewer = UUID.randomUUID();
        json(get(viewerPath(viewer)).header("X-Participant-Token", receipt), 200);
        String frame = viewerPath(viewer) + "/frame";
        String upload = staffPath() + "/" + share.get("id").asText() + "/frame";
        byte[] jpeg = FrameFixture.jpeg(16, 9);
        json(put(upload).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_JPEG).content(jpeg), 204);
        json(post("/api/v1/courses/{course}/sessions/{session}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(get(frame).header("X-Participant-Token", receipt), 204);
        json(put(upload).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_JPEG).content(jpeg), 409);
        json(post("/api/v1/courses/{course}/sessions/{session}/resume", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        json(get(frame).header("X-Participant-Token", receipt), 204);
        json(delete(staffPath() + "/" + share.get("id").asText())
                .header("Authorization", "Bearer " + lecturerToken), 204);
        json(get(frame).header("X-Participant-Token", receipt), 204);
    }

    private JsonNode startShare() throws Exception {
        return json(post(staffPath()).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"sourceName\":\"Teaching window\"}"), 200);
    }
    private String staffPath() {
        return "/api/v1/courses/" + courseId + "/sessions/" + sessionId + "/screen-share";
    }
    private String viewerPath(UUID viewer) {
        return "/api/v1/student/sessions/" + joinCode + "/screen-share/viewers/" + viewer;
    }
    private String sdp(String value) throws Exception {
        return objectMapper.writeValueAsString(Map.of("sdp", value));
    }
}
