package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import ru.university.assistant.projection.api.FrameFixture;
import ru.university.assistant.projection.api.VideoFixture;
import ru.university.assistant.projection.api.ProjectionContracts.Platform;
import ru.university.assistant.projection.api.ProjectionContracts.SignedReleaseEnvelope;
import ru.university.assistant.projection.internal.ProjectionCatalogStore;
import ru.university.assistant.projection.internal.ProjectionReleaseVerifier;
import ru.university.assistant.projection.internal.ProjectionReleaseVerifier.VerifiedRelease;

/** Real persistence and HTTP/security tests: device tokens must not bypass current course/policy checks. */
class ProjectionIntegrationTest extends LiveFlowTestBase {
    @Autowired ProjectionCatalogStore releaseCheckpoints;
    private static final List<Map<String, Object>> SCREENS = List.of(Map.of(
            "id", "hdmi-1", "label", "External display", "width", 1920, "height", 1080, "isPrimary", false));

    @BeforeEach
    void resetProjectionPolicy() {
        jdbc.sql("delete from projection.release_checkpoints").update();
        jdbc.sql("""
                insert into projection.policy(singleton) values (true)
                on conflict(singleton) do update set agent_allowed = false, minimum_version = '0.1.0',
                    revision = 0, updated_by = null
                """).update();
    }

    @Test
    void disabledByDefaultAndSettingsAreStaffOnly() throws Exception {
        JsonNode settings = settings(lecturerToken);
        assertFalse(settings.get("agentAllowed").asBoolean());
        assertTrue(settings.get("latestVersion").isNull());
        assertEquals(0, settings.get("installers").size());
        assertEquals(0, settings.get("devices").size());
        json(get("/api/v1/projection/settings"), 401);
        json(get("/api/v1/projection/settings").header("Authorization", "Bearer " + maxLogin(822201)), 403);
        json(post("/api/v1/projection/pairings").header("Authorization", "Bearer " + lecturerToken), 403);
        json(put("/api/v1/admin/projection/policy").header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"agentAllowed\":true,\"minimumVersion\":\"0.1.0\",\"expectedRevision\":0}"), 403);
        policy(true, "0.1.0");
        json(put("/api/v1/admin/projection/policy").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"agentAllowed\":false,\"minimumVersion\":\"0.1.0\",\"expectedRevision\":0}"), 409);
        assertTrue(settings(lecturerToken).get("agentAllowed").asBoolean());
    }

    @Test
    void pairingIsOneTimeHashedAndSeparateFromStaffJwt() throws Exception {
        policy(true, "0.1.0");
        JsonNode code = pairing();
        JsonNode paired = pair(code.get("pairingCode").asText(), 201);
        String token = paired.get("deviceToken").asText();
        assertEquals(64, token.length());
        assertNotEquals(token, jdbc.sql("select token_hash from projection.devices")
                .query(String.class).single());
        assertNotEquals(code.get("pairingCode").asText(), jdbc.sql("select code_hash from projection.pairings")
                .query(String.class).single());
        pair(code.get("pairingCode").asText(), 401);
        poll(lecturerToken, "IDLE", null, SCREENS, 401);
        poll("0".repeat(64), "IDLE", null, SCREENS, 401);
        JsonNode initial = poll(token, "IDLE", null, SCREENS, 200);
        assertFalse(initial.get("mustStop").asBoolean());
        assertTrue(initial.get("leaseUntil").isNull());
        assertTrue(settings(lecturerToken).get("devices").get(0).get("connected").asBoolean());
        assertEquals(0, settings(adminToken).get("devices").size());
    }

    @Test
    void staleExpiredOrDisabledPairingCannotBeExchanged() throws Exception {
        policy(true, "0.1.0");
        String old = pairing().get("pairingCode").asText();
        pairing();
        pair(old, 401);
        String expired = pairing().get("pairingCode").asText();
        jdbc.sql("update projection.pairings set expires_at = now() - interval '1 minute'").update();
        pair(expired, 401);
        String stale = pairing().get("pairingCode").asText();
        policy(true, "0.1.1");
        pair(stale, 401);
        String account = pairing().get("pairingCode").asText();
        jdbc.sql("update iam.persons set status = 'DISABLED' where email = 'lecturer@example.test'").update();
        pair(account, 401);
    }

    @Test
    void publicStartNeedsPhysicalTestCodeAndIsIdempotent() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        command(id, "START_PUBLIC_PROJECTION", true, "ABCDEF", UUID.randomUUID(), 409);
        JsonNode test = command(id, "TEST_TARGET", false, null, UUID.randomUUID(), 202);
        assertTrue(test.get("payload").get("joinCode").isNull());
        JsonNode delivery = poll(token, "IDLE", null, SCREENS, 200);
        assertEquals(test.get("id"), delivery.get("commands").get(0).get("id"));
        String code = test.get("payload").get("testCode").asText();
        command(id, "START_PUBLIC_PROJECTION", true, code, UUID.randomUUID(), 409);
        poll(token, "TESTING", ack(test, "COMPLETED"), SCREENS, 200);
        command(id, "START_PUBLIC_PROJECTION", false, code, UUID.randomUUID(), 409);
        UUID requestId = UUID.randomUUID();
        JsonNode start = command(id, "START_PUBLIC_PROJECTION", true, code, requestId, 202);
        assertEquals(start.get("id"), command(id, "START_PUBLIC_PROJECTION", true, code, requestId, 202).get("id"));
        String viewToken = start.get("payload").get("projectionViewToken").asText();
        json(get(projectionViewerPath(joinCode, UUID.randomUUID()))
                .header("X-Projection-View-Token", viewToken), 401);
        command(id, "TEST_TARGET", false, null, requestId, 409);
        JsonNode show = poll(token, "TESTING", null, SCREENS, 200);
        assertEquals(joinCode, show.get("commands").get(0).get("payload").get("joinCode").asText());
        assertFalse(show.toString().contains("password"));
        assertFalse(show.get("leaseUntil").isNull());
    }

    @Test
    void changingTopologyInvalidatesBothTestAndActiveLease() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        JsonNode test = command(id, "TEST_TARGET", false, null, UUID.randomUUID(), 202);
        poll(token, "IDLE", null, SCREENS, 200);
        poll(token, "TESTING", ack(test, "COMPLETED"), SCREENS, 200);
        JsonNode changed = poll(token, "TESTING", null, List.of(), 200);
        assertTrue(changed.get("mustStop").asBoolean());
        assertTrue(changed.get("leaseUntil").isNull());
        command(id, "START_PUBLIC_PROJECTION", true, test.get("payload").get("testCode").asText(),
                UUID.randomUUID(), 409);
    }

    @Test
    void policyDisableStopsInstalledHelperButRetainsSecurityUpdateChannel() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        startOutput(id, token);
        policy(false, "0.2.0");
        JsonNode stopped = poll(token, "SHOWING", null, SCREENS, 200);
        assertTrue(stopped.get("mustStop").asBoolean());
        assertTrue(stopped.get("leaseUntil").isNull());
        assertFalse(stopped.get("policy").get("allowed").asBoolean());
        assertTrue(stopped.get("updateRequired").asBoolean());
        command(id, "TEST_TARGET", false, null, UUID.randomUUID(), 403);
        command(id, "CHECK_UPDATE", false, null, UUID.randomUUID(), 202);
        JsonNode update = poll(token, "IDLE", null, SCREENS, 200);
        assertEquals("CHECK_UPDATE", update.get("commands").get(0).get("type").asText());
        assertTrue(update.get("release").isNull());
        assertEquals("LIVE", json(get("/api/v1/courses/{course}/sessions/{session}", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200).get("status").asText());
    }

    @Test
    void mandatoryUpdateDoesNotInterruptCurrentShowAndUpdateFailureDoesNotStopIt() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        startOutput(id, token);
        policy(true, "0.2.0");
        JsonNode current = poll(token, "SHOWING", null, SCREENS, 200);
        assertFalse(current.get("mustStop").asBoolean());
        assertFalse(current.get("leaseUntil").isNull());
        assertTrue(current.get("updateRequired").asBoolean());
        command(id, "TEST_TARGET", false, null, UUID.randomUUID(), 409);
        JsonNode update = command(id, "CHECK_UPDATE", false, null, UUID.randomUUID(), 202);
        poll(token, "SHOWING", null, SCREENS, 200);
        JsonNode failedUpdate = poll(token, "SHOWING", ack(update, "FAILED"), SCREENS, 200);
        assertFalse(failedUpdate.get("mustStop").asBoolean());
        assertFalse(failedUpdate.get("leaseUntil").isNull());
    }

    @Test
    void courseAndAccountRevocationsAreRecheckedDuringPoll() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        startOutput(id, token);
        jdbc.sql("delete from org.course_members where course_id = ?").param(courseId).update();
        JsonNode revoked = poll(token, "SHOWING", null, SCREENS, 200);
        assertTrue(revoked.get("mustStop").asBoolean());
        assertTrue(revoked.get("leaseUntil").isNull());
        jdbc.sql("update iam.persons set status = 'DISABLED' where email = 'lecturer@example.test'").update();
        JsonNode account = poll(token, "IDLE", null, SCREENS, 200);
        assertFalse(account.get("policy").get("allowed").asBoolean());
        assertTrue(account.get("mustStop").asBoolean());
    }

    @Test
    void expiredLeaseAndEndedSessionCannotBeRenewed() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        startOutput(id, token);
        jdbc.sql("update projection.devices set active_until = now() - interval '1 minute'").update();
        JsonNode expired = poll(token, "SHOWING", null, SCREENS, 200);
        assertTrue(expired.get("mustStop").asBoolean());
        assertTrue(expired.get("leaseUntil").isNull());
        startOutput(id, token);
        json(post("/api/v1/courses/{course}/sessions/{session}/end", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken), 200);
        JsonNode ended = poll(token, "SHOWING", null, SCREENS, 200);
        assertTrue(ended.get("mustStop").asBoolean());
    }

    @Test
    void delayedUnacknowledgedStartCannotResurrectExpiredOutput() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        JsonNode test = command(id, "TEST_TARGET", false, null, UUID.randomUUID(), 202);
        poll(token, "IDLE", null, SCREENS, 200);
        poll(token, "TESTING", ack(test, "COMPLETED"), SCREENS, 200);
        command(id, "START_PUBLIC_PROJECTION", true,
                test.get("payload").get("testCode").asText(), UUID.randomUUID(), 202);
        command(id, "CHECK_UPDATE", false, null, UUID.randomUUID(), 202);
        JsonNode delivered = poll(token, "TESTING", null, SCREENS, 200);
        assertEquals(1, delivered.get("commands").size());
        assertEquals("START_PUBLIC_PROJECTION", delivered.get("commands").get(0).get("type").asText());
        jdbc.sql("update projection.devices set active_until = now() - interval '1 minute'").update();
        JsonNode retry = poll(token, "SHOWING", null, SCREENS, 200);
        assertTrue(retry.get("mustStop").asBoolean());
        assertTrue(retry.get("leaseUntil").isNull());
        assertEquals(1, retry.get("commands").size());
        assertEquals("CHECK_UPDATE", retry.get("commands").get(0).get("type").asText());
    }

    @Test
    void anotherStaffCannotCommandRevokeOrAcknowledgeSomeoneElsesDevice() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        json(delete("/api/v1/projection/devices/{id}", id)
                .header("Authorization", "Bearer " + adminToken), 403);
        json(post("/api/v1/courses/{course}/sessions/{session}/projection/commands", courseId, sessionId)
                .header("Authorization", "Bearer " + adminToken).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("deviceId", id, "requestId", UUID.randomUUID(),
                        "type", "STOP_PROJECTION"))), 403);
        JsonNode other = pair(pairing().get("pairingCode").asText(), 201);
        poll(other.get("deviceToken").asText(), "IDLE", Map.of("commandId", UUID.randomUUID(),
                "result", "COMPLETED"), SCREENS, 409);
        json(delete("/api/v1/projection/devices/{id}", id)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        poll(device.get("deviceToken").asText(), "IDLE", null, SCREENS, 401);
    }

    @Test
    void mediaGrantIsSeparateReadOnlyCredentialBoundToPublicDeviceOutput() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        JsonNode start = startOutput(id, device.get("deviceToken").asText());
        String grant = start.get("payload").get("projectionViewToken").asText();
        assertEquals(64, grant.length());
        assertNotEquals(grant, device.get("deviceToken").asText());
        assertNotEquals(grant, jdbc.sql("select view_token_hash from projection.commands where id = ?")
                .param(UUID.fromString(start.get("id").asText())).query(String.class).single());
        UUID viewerId = UUID.randomUUID();
        String path = projectionViewerPath(joinCode, viewerId);
        json(get(path), 401);
        json(get(path).header("Authorization", "Bearer " + lecturerToken), 401);
        json(get(path).header("X-Projection-View-Token", device.get("deviceToken").asText()), 401);
        json(get(path).header("X-Projection-View-Token", grant), 204);
        json(get(projectionViewerPath("OTHER1", viewerId)).header("X-Projection-View-Token", grant), 403);
        json(post("/api/v1/courses/{course}/sessions/{session}/screen-share", courseId, sessionId)
                .header("Authorization", "Bearer " + grant).contentType(MediaType.APPLICATION_JSON)
                .content("{\"sourceName\":\"Unauthorized host\"}"), 401);
    }

    @Test
    void nativeViewGrantCanReceiveShareStartedAfterPublicWindowWasOpened() throws Exception {
        JsonNode device = readyDevice();
        JsonNode start = startOutput(UUID.fromString(device.get("deviceId").asText()),
                device.get("deviceToken").asText());
        String grant = start.get("payload").get("projectionViewToken").asText();
        UUID viewerId = UUID.randomUUID();
        String viewerPath = projectionViewerPath(joinCode, viewerId);
        json(get(viewerPath).header("X-Projection-View-Token", grant), 204);
        JsonNode share = json(post("/api/v1/courses/{course}/sessions/{session}/screen-share", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"sourceName\":\"IDE window\"}"), 200);
        json(get(viewerPath).header("X-Projection-View-Token", grant), 200);
        String shareId = share.get("id").asText();
        String sdp = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
        json(put("/api/v1/courses/{course}/sessions/{session}/screen-share/{share}/viewers/{viewer}",
                courseId, sessionId, shareId, viewerId).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("sdp", sdp))), 204);
        assertEquals(sdp, json(get(viewerPath).header("X-Projection-View-Token", grant), 200).get("offer").asText());
        json(put(viewerPath + "/" + shareId).header("X-Projection-View-Token", grant)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("sdp", sdp))), 204);
        json(get(viewerPath + "/frame").header("X-Projection-View-Token", grant), 204);
        byte[] jpeg = FrameFixture.jpeg(16, 9);
        json(put("/api/v1/courses/{course}/sessions/{session}/screen-share/{share}/frame",
                courseId, sessionId, shareId).header("Authorization", "Bearer " + lecturerToken)
                .contentType(MediaType.IMAGE_JPEG).content(jpeg), 204);
        mockMvc.perform(get(viewerPath + "/frame").header("X-Projection-View-Token", grant))
                .andExpect(status().isOk()).andExpect(content().bytes(jpeg));
        json(post("/api/v1/courses/{course}/sessions/{session}/projection/commands", courseId, sessionId)
                .header("X-Projection-View-Token", grant).contentType(MediaType.APPLICATION_JSON)
                .content("{}"), 401);
        UUID epoch = UUID.randomUUID();
        String upload = "/api/v1/courses/" + courseId + "/sessions/" + sessionId
                + "/screen-share/" + shareId + "/video/" + epoch;
        json(put(upload + "/init?codec=" + VideoFixture.CODEC).header("Authorization", "Bearer " + lecturerToken)
                .contentType("video/mp4").content(VideoFixture.init()), 204);
        json(put(upload + "/segments/0").header("Authorization", "Bearer " + lecturerToken)
                .contentType("video/mp4").content(VideoFixture.segment()), 204);
        json(get(viewerPath + "/video").header("X-Projection-View-Token", grant), 200);
        mockMvc.perform(get(viewerPath + "/video/" + epoch + "/segments/0")
                .header("X-Projection-View-Token", grant).accept("video/mp4"))
                .andExpect(status().isOk()).andExpect(content().bytes(VideoFixture.segment()));
        policy(false, "0.1.0");
        json(get(viewerPath + "/video").header("X-Projection-View-Token", grant), 403);
    }

    @Test
    void mediaGrantIsRevokedByPolicyLeaseAndDeviceRevocation() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        String grant = startOutput(id, token).get("payload").get("projectionViewToken").asText();
        String viewerPath = projectionViewerPath(joinCode, UUID.randomUUID());
        json(get(viewerPath).header("X-Projection-View-Token", grant), 204);
        policy(false, "0.1.0");
        json(get(viewerPath).header("X-Projection-View-Token", grant), 403);
        policy(true, "0.1.0");
        json(get(viewerPath).header("X-Projection-View-Token", grant), 401);
        grant = startOutput(id, token).get("payload").get("projectionViewToken").asText();
        jdbc.sql("update projection.devices set active_until = now() - interval '1 second'").update();
        json(get(viewerPath).header("X-Projection-View-Token", grant), 401);
        grant = startOutput(id, token).get("payload").get("projectionViewToken").asText();
        json(delete("/api/v1/projection/devices/{id}", id)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        json(get(viewerPath).header("X-Projection-View-Token", grant), 401);
    }

    @Test
    void mediaGrantCannotOutliveOwnerPermissionsOrEightHourExpiry() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        String grant = startOutput(id, token).get("payload").get("projectionViewToken").asText();
        String viewerPath = projectionViewerPath(joinCode, UUID.randomUUID());
        jdbc.sql("update projection.commands set view_token_expires_at = now() - interval '1 second'")
                .update();
        json(get(viewerPath).header("X-Projection-View-Token", grant), 401);
        grant = startOutput(id, token).get("payload").get("projectionViewToken").asText();
        jdbc.sql("delete from org.course_members where course_id = ?").param(courseId).update();
        json(get(viewerPath).header("X-Projection-View-Token", grant), 403);
    }

    @Test
    void localStopRevokesMediaGrantButInitialIdlePollStillDeliversNewCommands() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        String grant = startOutput(id, token).get("payload").get("projectionViewToken").asText();
        String viewerPath = projectionViewerPath(joinCode, UUID.randomUUID());
        json(get(viewerPath).header("X-Projection-View-Token", grant), 204);
        JsonNode stopped = poll(token, "IDLE", null, SCREENS, 200);
        assertTrue(stopped.get("leaseUntil").isNull());
        assertFalse(stopped.get("mustStop").asBoolean());
        json(get(viewerPath).header("X-Projection-View-Token", grant), 401);
        command(id, "TEST_TARGET", false, null, UUID.randomUUID(), 202);
        JsonNode test = poll(token, "IDLE", null, SCREENS, 200);
        assertEquals("TEST_TARGET", test.get("commands").get(0).get("type").asText());
        assertFalse(test.get("leaseUntil").isNull());
    }

    @Test
    void releaseCheckpointPersistsRejectsRollbackAndReusedSequenceAndUpdatesCatalogAtomically() {
        VerifiedRelease windows = release(Platform.WINDOWS_X64, 10, "0.2.0", "a");
        VerifiedRelease mac = release(Platform.MACOS_ARM64, 10, "0.2.0", "b");
        releaseCheckpoints.accept(List.of(windows, mac));
        releaseCheckpoints.accept(List.of(windows, mac));
        org.junit.jupiter.api.Assertions.assertThrows(ProjectionReleaseVerifier.CatalogException.class,
                () -> releaseCheckpoints.accept(List.of(release(Platform.WINDOWS_X64, 9, "0.2.0", "a"))));
        org.junit.jupiter.api.Assertions.assertThrows(ProjectionReleaseVerifier.CatalogException.class,
                () -> releaseCheckpoints.accept(List.of(release(Platform.WINDOWS_X64, 11, "0.1.0", "c"))));
        org.junit.jupiter.api.Assertions.assertThrows(ProjectionReleaseVerifier.CatalogException.class,
                () -> releaseCheckpoints.accept(List.of(release(Platform.WINDOWS_X64, 10, "0.2.0", "d"))));
        // MAC sorts first and would advance without a transaction; a rejected WIN rolls the whole batch back.
        org.junit.jupiter.api.Assertions.assertThrows(ProjectionReleaseVerifier.CatalogException.class,
                () -> releaseCheckpoints.accept(List.of(release(Platform.MACOS_ARM64, 11, "0.3.0", "c"),
                        release(Platform.WINDOWS_X64, 9, "0.2.0", "d"))));
        assertEquals(List.of(10L, 10L), jdbc.sql(
                        "select sequence from projection.release_checkpoints order by platform")
                .query(Long.class).list());
        assertEquals(2, jdbc.sql("select count(*) from projection.release_checkpoints").query(Integer.class).single());
    }

    private VerifiedRelease release(Platform platform, long sequence, String version, String digest) {
        return new VerifiedRelease(platform, "UPDATE", version, "10.0", sequence,
                java.time.Instant.now().plusSeconds(3600),
                "https://github.com/institution/projector-agent/releases/download/v2/package.zip", 100,
                digest.repeat(64), new SignedReleaseEnvelope("test-key", "e30=", "unused"), digest.repeat(64));
    }

    private JsonNode settings(String jwt) throws Exception {
        return json(get("/api/v1/projection/settings").header("Authorization", "Bearer " + jwt), 200);
    }

    private JsonNode policy(boolean allowed, String version) throws Exception {
        return json(put("/api/v1/admin/projection/policy").header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(Map.of(
                        "agentAllowed", allowed, "minimumVersion", version,
                        "expectedRevision", settings(adminToken).get("revision").asLong()))), 200);
    }

    private JsonNode pairing() throws Exception {
        return json(post("/api/v1/projection/pairings").header("Authorization", "Bearer " + lecturerToken), 201);
    }

    private JsonNode pair(String code, int expected) throws Exception {
        return json(post("/api/v1/projection/agent/pair").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("pairingCode", code, "name", "Room 12",
                        "platform", "WINDOWS_X64", "version", "0.1.0", "osVersion", "10.0.26100",
                        "protocolVersion", 1))), expected);
    }

    private JsonNode readyDevice() throws Exception {
        policy(true, "0.1.0");
        JsonNode device = pair(pairing().get("pairingCode").asText(), 201);
        poll(device.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        return device;
    }

    private JsonNode command(UUID deviceId, String type, boolean confirmed, String testCode,
            UUID requestId, int expected) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("deviceId", deviceId);
        body.put("requestId", requestId);
        body.put("type", type);
        body.put("targetScreenId", "hdmi-1");
        body.put("displayConfirmed", confirmed);
        body.put("testCode", testCode);
        return json(post("/api/v1/courses/{course}/sessions/{session}/projection/commands", courseId, sessionId)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)), expected);
    }

    private JsonNode poll(String token, String status, Map<String, Object> ack,
            List<Map<String, Object>> screens, int expected) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("version", "0.1.0");
        body.put("protocolVersion", 1);
        body.put("status", status);
        body.put("screens", screens);
        body.put("ack", ack);
        return json(post("/api/v1/projection/agent/poll").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body)), expected);
    }

    private Map<String, Object> ack(JsonNode command, String result) {
        return Map.of("commandId", command.get("id").asText(), "result", result);
    }

    private JsonNode startOutput(UUID deviceId, String token) throws Exception {
        JsonNode test = command(deviceId, "TEST_TARGET", false, null, UUID.randomUUID(), 202);
        poll(token, "IDLE", null, SCREENS, 200);
        poll(token, "TESTING", ack(test, "COMPLETED"), SCREENS, 200);
        JsonNode start = command(deviceId, "START_PUBLIC_PROJECTION", true,
                test.get("payload").get("testCode").asText(), UUID.randomUUID(), 202);
        poll(token, "TESTING", null, SCREENS, 200);
        poll(token, "SHOWING", ack(start, "COMPLETED"), SCREENS, 200);
        return start;
    }

    private String projectionViewerPath(String code, UUID viewerId) {
        return "/api/v1/projection/agent/view/sessions/" + code + "/screen-share/viewers/" + viewerId;
    }
}
