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
    void roomAdmissionReservesCapacityAcrossConcurrentGrantsAndAllowsRenewalAtCapacity()
            throws Exception {
        var user = tokens.parseAccessToken(lecturerToken).orElseThrow();
        UUID room = (UUID) media.start(user, courseId, sessionId, "Capacity").get("id");
        media.publisherGrant(user, courseId, sessionId, room);
        jdbc.sql(
                        """
            insert into projection.sfu_grants(id,room_id,person_id,auth_version,viewer_id,publisher,expires_at)
            select gen_random_uuid(),:room,gen_random_uuid(),1,gen_random_uuid(),false,now()+interval '2 minutes'
            from generate_series(1,1498)
            """)
                .param("room", room)
                .update();
        var student = join(null, "{\"displayName\":\"Last viewers\"}");
        var viewer =
                viewers.requireViewer(joinCode, null, student.get("participantToken").asText());
        var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        var start = new java.util.concurrent.CountDownLatch(1);
        try {
            var jobs =
                    new java.util.ArrayList<
                            java.util.concurrent.Future<java.util.Map<String, Object>>>();
            for (int i = 0; i < 2; i++)
                jobs.add(
                        pool.submit(
                                () -> {
                                    start.await();
                                    try {
                                        return media.viewerGrant(viewer, UUID.randomUUID(), false);
                                    } catch (
                                            org.springframework.web.server.ResponseStatusException
                                                    denied) {
                                        assertEquals(429, denied.getStatusCode().value());
                                        return java.util.Map.of();
                                    }
                                }));
            start.countDown();
            int admitted = 0;
            for (var job : jobs)
                if (!job.get(5, java.util.concurrent.TimeUnit.SECONDS).isEmpty()) admitted++;
            assertEquals(1, admitted);
            assertEquals(
                    1500L,
                    jdbc.sql("select count(*) from projection.sfu_grants where room_id=:room")
                            .param("room", room)
                            .query(Long.class)
                            .single());
            UUID viewerId =
                    jdbc.sql(
                                    "select viewer_id from projection.sfu_grants where room_id=:room and"
                                    + " person_id=:person")
                            .param("room", room)
                            .param("person", viewer.personId())
                            .query(UUID.class)
                            .single();
            org.junit.jupiter.api.Assertions.assertNotNull(
                    media.viewerGrant(viewer, viewerId, false).get("grantId"));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void durableRoomHasOnePublisherAndStudentGrantIsRevokedWithAccountVersion() throws Exception {
        var user = tokens.parseAccessToken(lecturerToken).orElseThrow();
        UUID room = (UUID) media.start(user, courseId, sessionId, "Test screen").get("id");
        UUID publisher = media.publisherGrant(user, courseId, sessionId, room);
        var participant = join(null, "{\"displayName\":\"Student\"}");
        String token = participant.get("participantToken").asText();
        var viewer = viewers.requireViewer(joinCode, null, token);
        UUID grant = (UUID) media.viewerGrant(viewer, UUID.randomUUID(), false).get("grantId");
        var authorized =
                objectMapper.valueToTree(media.authorize(List.of(publisher, grant), List.of(room)));
        assertEquals(2, authorized.get("grants").size());
        assertEquals(1, authorized.get("rooms").size());
        assertEquals(
                1,
                authorized.get("grants").findValues("publisher").stream()
                        .filter(n -> n.asBoolean())
                        .count());
        jdbc.sql("update iam.persons set auth_version = auth_version + 1 where id = :id")
                .param("id", viewer.personId())
                .update();
        assertEquals(
                1,
                objectMapper
                        .valueToTree(media.authorize(List.of(publisher, grant), List.of(room)))
                        .get("grants")
                        .size());
    }

    @Test
    void pauseEndAndPublisherLeaseExpiryRemoveMediaAuthority() throws Exception {
        var user = tokens.parseAccessToken(lecturerToken).orElseThrow();
        UUID room = (UUID) media.start(user, courseId, sessionId, "Test screen").get("id");
        UUID grant = media.publisherGrant(user, courseId, sessionId, room);
        json(
                post("/api/v1/courses/{c}/sessions/{s}/pause", courseId, sessionId)
                        .header("Authorization", "Bearer " + lecturerToken),
                200);
        assertEquals(
                0,
                objectMapper
                        .valueToTree(media.authorize(List.of(grant), List.of(room)))
                        .get("rooms")
                        .size());
        json(
                post("/api/v1/courses/{c}/sessions/{s}/resume", courseId, sessionId)
                        .header("Authorization", "Bearer " + lecturerToken),
                200);
        assertEquals(
                1,
                objectMapper
                        .valueToTree(media.authorize(List.of(grant), List.of(room)))
                        .get("rooms")
                        .size());
        jdbc.sql("update projection.sfu_rooms set lease_until = now() - interval '1 second'")
                .update();
        assertEquals(
                0,
                objectMapper
                        .valueToTree(media.authorize(List.of(grant), List.of(room)))
                        .get("rooms")
                        .size());
    }

    @Test
    void startReplaysOneRoomAndRechecksAccessInsteadOfRepeatingCreation() throws Exception {
        String endpoint = "/api/v1/courses/" + courseId + "/sessions/" + sessionId + "/sfu-share";
        String key = UUID.randomUUID().toString();
        var first =
                json(
                        post(endpoint)
                                .header("Authorization", "Bearer " + lecturerToken)
                                .header("Idempotency-Key", key)
                                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                                .content("{\"sourceName\":\"Test screen\"}"),
                        200);
        var replay =
                json(
                        post(endpoint)
                                .header("Authorization", "Bearer " + lecturerToken)
                                .header("Idempotency-Key", key)
                                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                                .content("{\"sourceName\":\"Test screen\"}"),
                        200);
        assertEquals(first, replay);
        assertEquals(1L, count("projection.sfu_rooms"));
        mockMvc.perform(
                        post(endpoint)
                                .header("Authorization", "Bearer " + lecturerToken)
                                .header("Idempotency-Key", key)
                                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                                .content("{\"sourceName\":\"Changed screen\"}"))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                                .isConflict());
        jdbc.sql("update iam.persons set status = 'DISABLED' where email = 'lecturer@example.test'")
                .update();
        mockMvc.perform(
                        post(endpoint)
                                .header("Authorization", "Bearer " + lecturerToken)
                                .header("Idempotency-Key", key)
                                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                                .content("{\"sourceName\":\"Test screen\"}"))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                                .is4xxClientError());
    }
}
