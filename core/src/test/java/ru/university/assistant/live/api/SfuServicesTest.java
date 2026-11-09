package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import ru.university.assistant.iam.api.TokenAuthenticationApi;
import ru.university.assistant.projection.internal.SfuMediaService;

@TestPropertySource(properties = {"app.media.provider=sfu"})
class SfuServicesTest extends LiveFlowTestBase {
    @Autowired SfuMediaService media;
    @Autowired TokenAuthenticationApi tokens;
    @Autowired MediaViewingAccessApi viewers;

    @Test
    void durableRoomHasOnePublisherAndStudentGrantIsRevokedWithAccountVersion() throws Exception {
        var user = tokens.parseAccessToken(lecturerToken).orElseThrow();
        UUID room = (UUID) media.start(user, courseId, sessionId, "Test screen").get("id");
        UUID publisher = media.publisherGrant(user, courseId, sessionId, room);
        var participant = join(null, "{\"displayName\":\"Student\"}");
        String token = participant.get("participantToken").asText();
        var viewer = viewers.requireViewer(joinCode, null, token);
        UUID grant = (UUID) media.viewerGrant(viewer, UUID.randomUUID(), false).get("grantId");
        var authorized = objectMapper.valueToTree(media.authorize(List.of(publisher, grant), List.of(room)));
        assertEquals(2, authorized.get("grants").size());
        assertEquals(1, authorized.get("rooms").size());
        assertEquals(1, authorized.get("grants").findValues("publisher").stream().filter(n -> n.asBoolean()).count());
        jdbc.sql("update iam.persons set auth_version = auth_version + 1 where id = :id")
                .param("id", viewer.personId()).update();
        assertEquals(1, objectMapper.valueToTree(media.authorize(List.of(publisher, grant), List.of(room)))
                .get("grants").size());
    }

    @Test
    void pauseEndAndPublisherLeaseExpiryRemoveMediaAuthority() throws Exception {
        var user = tokens.parseAccessToken(lecturerToken).orElseThrow();
        UUID room = (UUID) media.start(user, courseId, sessionId, "Test screen").get("id");
        UUID grant = media.publisherGrant(user, courseId, sessionId, room);
        json(post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(0, objectMapper.valueToTree(media.authorize(List.of(grant), List.of(room))).get("rooms").size());
        json(post("/api/v1/courses/{c}/sessions/{s}/resume", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        assertEquals(1, objectMapper.valueToTree(media.authorize(List.of(grant), List.of(room))).get("rooms").size());
        jdbc.sql("update projection.sfu_rooms set lease_until = now() - interval '1 second'").update();
        assertEquals(0, objectMapper.valueToTree(media.authorize(List.of(grant), List.of(room))).get("rooms").size());
    }

    @Test
    void startReplaysOneRoomAndRechecksAccessInsteadOfRepeatingCreation() throws Exception {
        String endpoint = "/api/v1/courses/" + courseId + "/sessions/" + sessionId + "/sfu-share";
        String key = UUID.randomUUID().toString();
        var first = json(post(endpoint).header("Authorization", "Bearer " + lecturerToken)
                .header("Idempotency-Key", key).contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{\"sourceName\":\"Test screen\"}"), 200);
        var replay = json(post(endpoint).header("Authorization", "Bearer " + lecturerToken)
                .header("Idempotency-Key", key).contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{\"sourceName\":\"Test screen\"}"), 200);
        assertEquals(first, replay);
        assertEquals(1L, count("projection.sfu_rooms"));
        mockMvc.perform(post(endpoint).header("Authorization", "Bearer " + lecturerToken)
                .header("Idempotency-Key", key).contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{\"sourceName\":\"Changed screen\"}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isConflict());
        jdbc.sql("update iam.persons set status = 'DISABLED' where email = 'lecturer@example.test'").update();
        mockMvc.perform(post(endpoint).header("Authorization", "Bearer " + lecturerToken)
                .header("Idempotency-Key", key).contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{\"sourceName\":\"Test screen\"}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                        .is4xxClientError());
    }
}
