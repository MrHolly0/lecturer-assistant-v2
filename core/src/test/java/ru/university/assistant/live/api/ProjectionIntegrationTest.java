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
import ru.university.assistant.projection.api.ProjectionContracts.PairRequest;
import ru.university.assistant.projection.api.ProjectionContracts.Platform;
import ru.university.assistant.projection.api.ProjectionContracts.SignedReleaseEnvelope;
import ru.university.assistant.projection.internal.ProjectionCatalogStore;
import ru.university.assistant.projection.internal.ProjectionReleaseVerifier;
import ru.university.assistant.projection.internal.ProjectionReleaseVerifier.VerifiedRelease;

/** Real persistence and HTTP/security tests: device tokens must not bypass current course/policy checks. */
class ProjectionIntegrationTest extends LiveFlowTestBase {
    @Autowired ProjectionCatalogStore releaseCheckpoints;
    private String deviceVersion = "0.1.0";
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
    void stableInstallationReusesDeviceRotatesTokenAndConsumesFreshCodeOnlyOnce() throws Exception {
        policy(true, "0.1.0");
        deviceVersion = "0.2.5";
        UUID installation = UUID.randomUUID();
        JsonNode first = pairWithIdentity(pairing().get("pairingCode").asText(), installation, null, 201);
        String oldToken = first.get("deviceToken").asText();
        String code = pairing().get("pairingCode").asText();
        deviceVersion = "0.2.6";
        JsonNode again = pairWithIdentity(code, installation, oldToken, 201);
        assertEquals(first.get("deviceId"), again.get("deviceId"));
        assertNotEquals(oldToken, again.get("deviceToken").asText());
        assertEquals(1, jdbc.sql("select count(*) from projection.devices").query(Integer.class).single());
        assertEquals(installation, jdbc.sql("select installation_id from projection.devices")
                .query(UUID.class).single());
        assertEquals("0.2.6", settings(lecturerToken).at("/devices/0/version").asText());
        poll(oldToken, "IDLE", null, SCREENS, 401);
        pairWithIdentity(code, installation, again.get("deviceToken").asText(), 401);
        poll(again.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        // Existing Java callers and pre-0.2.5 wire bodies retain their six-field contract.
        PairRequest legacy = new PairRequest("ABCDEFGH2345", "Room 12", Platform.WINDOWS_X64,
                "0.1.0", "10.0.26100", 1);
        assertTrue(legacy.installationId() == null && legacy.previousDeviceToken() == null);
    }

    @Test
    void previousLocalKeyAdoptsLegacyDeviceAndPreservesItsThemeAndCreationTime() throws Exception {
        JsonNode first = readyDevice();
        UUID id = UUID.fromString(first.get("deviceId").asText());
        String created = jdbc.sql("select created_at::text from projection.devices where id = ?")
                .param(id).query(String.class).single();
        appearance(id, lecturerToken, "{\"theme\":\"dark\"}", 204);
        UUID installation = UUID.randomUUID();
        deviceVersion = "0.2.5";
        JsonNode adopted = pairWithIdentity(pairing().get("pairingCode").asText(), installation,
                first.get("deviceToken").asText(), 201);
        assertEquals(first.get("deviceId"), adopted.get("deviceId"));
        assertEquals(1, jdbc.sql("select count(*) from projection.devices").query(Integer.class).single());
        assertEquals(created, jdbc.sql("select created_at::text from projection.devices where id = ?")
                .param(id).query(String.class).single());
        assertEquals(installation, jdbc.sql("select installation_id from projection.devices where id = ?")
                .param(id).query(UUID.class).single());
        assertFalse(settings(lecturerToken).at("/devices/0/connected").asBoolean());
        poll(first.get("deviceToken").asText(), "IDLE", null, SCREENS, 401);
        assertEquals("dark", poll(adopted.get("deviceToken").asText(), "IDLE", null, SCREENS, 200)
                .get("remoteTheme").asText());
    }

    @Test
    void legacyAndDifferentComputersWithTheSameNameAreNotMergedWithoutTheirKey() throws Exception {
        policy(true, "0.1.0");
        JsonNode legacyOne = pair(pairing().get("pairingCode").asText(), 201);
        JsonNode legacyTwo = pair(pairing().get("pairingCode").asText(), 201);
        JsonNode one = pairWithIdentity(pairing().get("pairingCode").asText(), UUID.randomUUID(), null, 201);
        JsonNode two = pairWithIdentity(pairing().get("pairingCode").asText(), UUID.randomUUID(), null, 201);
        assertNotEquals(legacyOne.get("deviceId"), legacyTwo.get("deviceId"));
        assertNotEquals(one.get("deviceId"), two.get("deviceId"));
        assertEquals(4, jdbc.sql("select count(*) from projection.devices").query(Integer.class).single());
        for (JsonNode device : List.of(legacyOne, legacyTwo, one, two)) {
            poll(device.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        }
        assertEquals(0, jdbc.sql("select count(*) from projection.devices where revoked_at is not null")
                .query(Integer.class).single());
    }

    @Test
    void previousKeyForAnotherInstallationOrUnknownKeyCannotMergeOrRevokeThatComputer() throws Exception {
        policy(true, "0.1.0");
        UUID firstInstallation = UUID.randomUUID();
        JsonNode first = pairWithIdentity(pairing().get("pairingCode").asText(), firstInstallation, null, 201);
        UUID secondInstallation = UUID.randomUUID();
        JsonNode second = pairWithIdentity(pairing().get("pairingCode").asText(), secondInstallation,
                first.get("deviceToken").asText(), 201);
        assertNotEquals(first.get("deviceId"), second.get("deviceId"));
        JsonNode unknown = pairWithIdentity(pairing().get("pairingCode").asText(), UUID.randomUUID(),
                "0".repeat(64), 201);
        assertNotEquals(first.get("deviceId"), unknown.get("deviceId"));
        JsonNode refreshed = pairWithIdentity(pairing().get("pairingCode").asText(), secondInstallation,
                first.get("deviceToken").asText(), 201);
        assertEquals(second.get("deviceId"), refreshed.get("deviceId"));
        poll(first.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        poll(second.get("deviceToken").asText(), "IDLE", null, SCREENS, 401);
        poll(refreshed.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        assertEquals(3, jdbc.sql("select count(*) from projection.devices").query(Integer.class).single());
        assertEquals(0, jdbc.sql("select count(*) from projection.devices where revoked_at is not null")
                .query(Integer.class).single());
    }

    @Test
    void aDifferentOwnerWithTheSameInstallationIdAndPreviousKeyGetsAnIndependentDevice() throws Exception {
        policy(true, "0.1.0");
        UUID installation = UUID.randomUUID();
        JsonNode first = pairWithIdentity(pairing().get("pairingCode").asText(), installation, null, 201);
        String adminCode = json(post("/api/v1/projection/pairings")
                .header("Authorization", "Bearer " + adminToken), 201).get("pairingCode").asText();
        JsonNode otherOwner = pairWithIdentity(adminCode, installation, first.get("deviceToken").asText(), 201);
        assertNotEquals(first.get("deviceId"), otherOwner.get("deviceId"));
        assertEquals(1, settings(lecturerToken).get("devices").size());
        assertEquals(1, settings(adminToken).get("devices").size());
        assertEquals(2, jdbc.sql("select count(*) from projection.devices where installation_id = ?")
                .param(installation).query(Integer.class).single());
        poll(first.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        poll(otherOwner.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        assertEquals(0, jdbc.sql("select count(*) from projection.devices where revoked_at is not null")
                .query(Integer.class).single());
    }

    @Test
    void revokedInstallationCanOnlyBeReauthorizedWithAFreshValidOwnerCode() throws Exception {
        policy(true, "0.1.0");
        UUID installation = UUID.randomUUID();
        String consumed = pairing().get("pairingCode").asText();
        JsonNode first = pairWithIdentity(consumed, installation, null, 201);
        UUID id = UUID.fromString(first.get("deviceId").asText());
        json(delete("/api/v1/projection/devices/{deviceId}", id)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        poll(first.get("deviceToken").asText(), "IDLE", null, SCREENS, 401);
        pairWithIdentity(consumed, installation, first.get("deviceToken").asText(), 401);
        pairWithIdentity("ABCDEFGH2345", installation, first.get("deviceToken").asText(), 401);
        String expired = pairing().get("pairingCode").asText();
        jdbc.sql("update projection.pairings set expires_at = now() - interval '1 minute'").update();
        pairWithIdentity(expired, installation, first.get("deviceToken").asText(), 401);
        String disabled = pairing().get("pairingCode").asText();
        policy(false, "0.1.0");
        pairWithIdentity(disabled, installation, first.get("deviceToken").asText(), 403);
        policy(true, "0.1.0");
        pairWithIdentity(disabled, installation, first.get("deviceToken").asText(), 401);
        JsonNode restored = pairWithIdentity(pairing().get("pairingCode").asText(), installation,
                first.get("deviceToken").asText(), 201);
        assertEquals(first.get("deviceId"), restored.get("deviceId"));
        assertEquals(1, jdbc.sql("select count(*) from projection.devices").query(Integer.class).single());
        poll(first.get("deviceToken").asText(), "IDLE", null, SCREENS, 401);
        poll(restored.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        assertFalse(settings(lecturerToken).at("/devices/0/revoked").asBoolean());
    }

    @Test
    void rePairClearsOutputAndPendingCommandsAndRevokesOldGrantsButKeepsThemeAndHistory() throws Exception {
        JsonNode first = readyWorkspaceDevice();
        UUID id = UUID.fromString(first.get("deviceId").asText());
        UUID installation = UUID.randomUUID();
        JsonNode adopted = pairWithIdentity(pairing().get("pairingCode").asText(), installation,
                first.get("deviceToken").asText(), 201);
        String token = adopted.get("deviceToken").asText();
        poll(token, "IDLE", null, SCREENS, 200);
        appearance(id, lecturerToken, "{\"theme\":\"dark\"}", 204);
        JsonNode start = startOutput(id, token);
        JsonNode focus = noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 202);
        jdbc.sql("update projection.devices set diagnostic_code = 'OLD_FAILURE' where id = ?").param(id).update();
        int history = jdbc.sql("select count(*) from projection.commands where device_id = ?")
                .param(id).query(Integer.class).single();
        JsonNode again = pairWithIdentity(pairing().get("pairingCode").asText(), installation, token, 201);
        assertEquals(first.get("deviceId"), again.get("deviceId"));
        assertEquals(1, jdbc.sql("""
                select count(*) from projection.devices where id = ? and active_course_id is null
                    and active_session_id is null and active_command_id is null and active_until is null
                    and last_seen_at is null and screens = '[]'::jsonb and diagnostic_code is null
                    and status = 'IDLE' and revoked_at is null and remote_theme = 'dark'
                """).param(id).query(Integer.class).single());
        assertEquals(0, jdbc.sql("""
                select count(*) from projection.commands where device_id = ? and acknowledged_at is null
                """).param(id).query(Integer.class).single());
        assertEquals("CANCELLED", jdbc.sql("select result from projection.commands where id = ?")
                .param(UUID.fromString(focus.get("id").asText())).query(String.class).single());
        assertEquals(history, jdbc.sql("select count(*) from projection.commands where device_id = ?")
                .param(id).query(Integer.class).single());
        poll(token, "SHOWING", null, SCREENS, 401);
        String control = start.at("/payload/controlToken").asText();
        String publicGrant = start.at("/payload/projectionViewToken").asText();
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
        json(get(projectionViewerPath(joinCode, UUID.randomUUID()))
                .header("X-Projection-View-Token", publicGrant), 401);
        JsonNode idle = poll(again.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        assertEquals("dark", idle.get("remoteTheme").asText());
        assertTrue(idle.get("leaseUntil").isNull());
        assertEquals(0, idle.get("commands").size());
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
    }

    @Test
    void stableDeviceCanRetireOnlyItsPresentedSameOwnerLegacyKeyWithoutDeletingHistory() throws Exception {
        policy(true, "0.1.0");
        UUID installation = UUID.randomUUID();
        JsonNode stable = pairWithIdentity(pairing().get("pairingCode").asText(), installation, null, 201);
        UUID stableId = UUID.fromString(stable.get("deviceId").asText());
        appearance(stableId, lecturerToken, "{\"theme\":\"light\"}", 204);
        JsonNode legacy = pair(pairing().get("pairingCode").asText(), 201);
        UUID legacyId = UUID.fromString(legacy.get("deviceId").asText());
        poll(legacy.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        JsonNode oldCommand = command(legacyId, "TEST_TARGET", false, null, UUID.randomUUID(), 202);
        JsonNode again = pairWithIdentity(pairing().get("pairingCode").asText(), installation,
                legacy.get("deviceToken").asText(), 201);
        assertEquals(stable.get("deviceId"), again.get("deviceId"));
        assertEquals(2, jdbc.sql("select count(*) from projection.devices").query(Integer.class).single());
        assertEquals(1, jdbc.sql("select count(*) from projection.devices where id = ? and revoked_at is not null")
                .param(legacyId).query(Integer.class).single());
        assertEquals("CANCELLED", jdbc.sql("select result from projection.commands where id = ?")
                .param(UUID.fromString(oldCommand.get("id").asText())).query(String.class).single());
        poll(legacy.get("deviceToken").asText(), "IDLE", null, SCREENS, 401);
        poll(stable.get("deviceToken").asText(), "IDLE", null, SCREENS, 401);
        assertEquals("light", poll(again.get("deviceToken").asText(), "IDLE", null, SCREENS, 200)
                .get("remoteTheme").asText());
    }

    @Test
    void pairingIdentityRejectsZeroUuidAndInvalidPreviousTokensWithoutConsumingTheCode() throws Exception {
        policy(true, "0.1.0");
        String code = pairing().get("pairingCode").asText();
        pairWithIdentity(code, new UUID(0, 0), null, 400);
        for (String invalid : List.of("", "a", "A".repeat(64), "0".repeat(63), "Bearer " + "0".repeat(64))) {
            pairWithIdentity(code, UUID.randomUUID(), invalid, 400);
        }
        assertEquals(0, jdbc.sql("select count(*) from projection.devices").query(Integer.class).single());
        pairWithIdentity(code, UUID.randomUUID(), null, 201);
    }

    @Test
    void remoteThemeIsPerDeviceAndOldProtocolCanPollWithoutAnAppearancePreference() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        JsonNode initial = poll(token, "IDLE", null, SCREENS, 200);
        assertEquals(1, initial.get("protocolVersion").asInt());
        assertTrue(initial.get("remoteTheme").isNull());
        String unchanged = deviceStateWithoutTheme(id);

        appearance(id, lecturerToken, "{\"theme\":\"dark\"}", 204);
        assertEquals(unchanged, deviceStateWithoutTheme(id));
        assertEquals(0, jdbc.sql("select count(*) from projection.commands").query(Integer.class).single());
        JsonNode dark = poll(token, "IDLE", null, SCREENS, 200);
        assertEquals("dark", dark.get("remoteTheme").asText());
        assertEquals(0, dark.get("commands").size());
        assertTrue(dark.get("leaseUntil").isNull());
        assertFalse(dark.get("mustStop").asBoolean());

        JsonNode other = pair(pairing().get("pairingCode").asText(), 201);
        assertTrue(poll(other.get("deviceToken").asText(), "IDLE", null, SCREENS, 200)
                .get("remoteTheme").isNull());
        appearance(id, lecturerToken, "{\"theme\":\"light\"}", 204);
        assertEquals("light", poll(token, "IDLE", null, SCREENS, 200).get("remoteTheme").asText());
    }

    @Test
    void changingRemoteThemeDoesNotOpenOrReplaceActiveOutputOrPrivateControl() throws Exception {
        JsonNode device = readyWorkspaceDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        startOutput(id, token);
        String unchanged = deviceStateWithoutTheme(id);
        int commands = jdbc.sql("select count(*) from projection.commands").query(Integer.class).single();
        appearance(id, lecturerToken, "{\"theme\":\"dark\"}", 204);
        appearance(id, lecturerToken, "{\"theme\":\"dark\"}", 204);
        assertEquals(unchanged, deviceStateWithoutTheme(id));
        assertEquals(commands, jdbc.sql("select count(*) from projection.commands").query(Integer.class).single());
        JsonNode showing = poll(token, "SHOWING", null, SCREENS, 200);
        assertEquals("dark", showing.get("remoteTheme").asText());
        assertFalse(showing.get("mustStop").asBoolean());
        assertEquals(0, showing.get("commands").size());
        assertEquals(sessionId.toString(), settings(lecturerToken).get("devices").get(0)
                .get("activeSessionId").asText());
    }

    @Test
    void remoteThemeRequiresStaffOwnershipAndValidExplicitTheme() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        appearance(id, null, "{\"theme\":\"dark\"}", 401);
        appearance(id, token, "{\"theme\":\"dark\"}", 401);
        appearance(id, maxLogin(822202), "{\"theme\":\"dark\"}", 403);
        appearance(id, adminToken, "{\"theme\":\"dark\"}", 403);
        appearance(UUID.randomUUID(), lecturerToken, "{\"theme\":\"dark\"}", 404);
        for (String invalid : List.of("{}", "{\"theme\":null}", "{\"theme\":\"\"}",
                "{\"theme\":\"system\"}", "{\"theme\":\"DARK\"}", "{\"theme\":\" dark\"}")) {
            appearance(id, lecturerToken, invalid, 400);
        }
        assertTrue(poll(token, "IDLE", null, SCREENS, 200).get("remoteTheme").isNull());
        assertEquals(0, jdbc.sql("select count(*) from projection.commands").query(Integer.class).single());
    }

    @Test
    void remoteThemeRespectsPolicyAndRevocationWithoutCreatingCommands() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        appearance(id, lecturerToken, "{\"theme\":\"dark\"}", 204);
        policy(false, "0.1.0");
        appearance(id, lecturerToken, "{\"theme\":\"light\"}", 403);
        JsonNode disabled = poll(token, "IDLE", null, SCREENS, 200);
        assertTrue(disabled.get("remoteTheme").isNull());
        assertTrue(disabled.get("mustStop").asBoolean());
        policy(true, "0.1.0");
        assertEquals("dark", poll(token, "IDLE", null, SCREENS, 200).get("remoteTheme").asText());
        json(delete("/api/v1/projection/devices/{deviceId}", id)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        appearance(id, lecturerToken, "{\"theme\":\"light\"}", 409);
        poll(token, "IDLE", null, SCREENS, 401);
        assertEquals("dark", jdbc.sql("select remote_theme from projection.devices where id = ?")
                .param(id).query(String.class).single());
        assertEquals(0, jdbc.sql("select count(*) from projection.commands").query(Integer.class).single());
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
    void displayPreparationAndNumbersDoNotRequireTargetOrCreateOutputLease() throws Exception {
        JsonNode device = readyWorkspaceDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        poll(token, "IDLE", null, List.of(), 200);
        for (String type : List.of("PREPARE_DISPLAYS", "IDENTIFY_SCREENS")) {
            JsonNode setup = noTargetCommand(id, type, 202);
            JsonNode delivered = poll(token, "IDLE", null, List.of(), 200);
            assertEquals(setup.get("id"), delivered.at("/commands/0/id"));
            assertEquals(type, delivered.at("/commands/0/type").asText());
            for (String privateField : List.of(
                    "targetScreenId", "projectionViewToken", "controlToken", "courseId", "sessionId")) {
                assertTrue(delivered.at("/commands/0/payload/" + privateField).isNull(), privateField);
            }
            assertTrue(delivered.get("leaseUntil").isNull());
            assertFalse(delivered.get("mustStop").asBoolean());
            assertEquals(0, count("projection.devices where active_command_id is not null"));
            poll(token, "IDLE", ack(setup, "COMPLETED"), List.of(), 200);
        }
    }

    @Test
    void privateControlGrantWorksForOneLessonAndCannotBecomeStaffOrPublicCredential() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        JsonNode start = startOutput(id, device.get("deviceToken").asText());
        String control = start.at("/payload/controlToken").asText();
        String publicView = start.at("/payload/projectionViewToken").asText();
        assertTrue(control.matches("[a-f0-9-]{36}\\.[a-f0-9]{64}"));
        assertTrue(control.startsWith(id + "."));
        assertNotEquals(publicView, control);
        assertNotEquals(device.get("deviceToken").asText(), control);
        assertEquals(courseId.toString(), start.at("/payload/courseId").asText());
        assertEquals(sessionId.toString(), start.at("/payload/sessionId").asText());
        String lesson = lectureControlPath();
        assertEquals(sessionId.toString(), json(get(lesson)
                .header("X-Lecture-Control-Token", control), 200).get("id").asText());
        json(get(lesson + "/questions").header("X-Lecture-Control-Token", control), 200);
        json(get(lesson + "/engagement").header("X-Lecture-Control-Token", control), 200);
        json(get(lesson + "/participants").header("X-Lecture-Control-Token", control), 200);
        json(get("/api/v1/courses/{course}/decks/{deck}", courseId, deckId)
                .header("X-Lecture-Control-Token", control), 200);

        String student = maxLogin(8771201);
        join(student, null);
        JsonNode question = json(post("/api/v1/student/sessions/{code}/questions", joinCode)
                .header("Authorization", "Bearer " + student).contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"Почему условие такое?\"}"), 201);
        JsonNode answered = json(put(lesson + "/questions/" + question.get("id").asText())
                .header("X-Lecture-Control-Token", control).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"ANSWERED\",\"answerText\":\"Разберём пример.\","
                        + "\"answerVisibility\":\"AUTHOR\"}"), 200);
        assertEquals("ANSWERED", answered.get("status").asText());
        assertEquals("Разберём пример.", answered.get("answerText").asText());
        assertEquals("AUTHOR", answered.get("answerVisibility").asText());

        UUID otherSession = UUID.fromString(startAnotherSession().get("id").asText());
        json(get("/api/v1/courses/{course}/sessions/{session}", courseId, otherSession)
                .header("X-Lecture-Control-Token", control), 403);
        json(get("/api/v1/courses/{course}/sessions/{session}", UUID.randomUUID(), sessionId)
                .header("X-Lecture-Control-Token", control), 403);
        json(get("/api/v1/auth/me").header("X-Lecture-Control-Token", control), 403);
        json(post("/api/v1/auth/refresh").header("X-Lecture-Control-Token", control), 403);
        json(put("/api/v1/admin/projection/policy").header("X-Lecture-Control-Token", control)
                .header("Authorization", "Bearer " + adminToken).contentType(MediaType.APPLICATION_JSON)
                .content("{\"agentAllowed\":false,\"minimumVersion\":\"0.1.0\",\"expectedRevision\":1}"), 403);
        json(post(lesson + "/projection/commands").header("X-Lecture-Control-Token", control)
                .contentType(MediaType.APPLICATION_JSON).content("{}"), 403);
        json(get(lesson).header("Authorization", "Bearer " + control), 401);
        json(get(lesson).header("X-Lecture-Control-Token", publicView), 401);
        json(get(lesson).header("X-Lecture-Control-Token", device.get("deviceToken").asText()), 401);
        json(get(projectionViewerPath(joinCode, UUID.randomUUID()))
                .header("X-Projection-View-Token", control), 401);
    }

    @Test
    void controlGrantExpiresWithOutputLeaseAndCannotSurviveAReplacementOrPolicyDisable() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        String control = startOutput(id, token).at("/payload/controlToken").asText();
        jdbc.sql("update projection.devices set active_until = now() - interval '1 minute'").update();
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
        String replacement = startOutput(id, token).at("/payload/controlToken").asText();
        assertNotEquals(control, replacement);
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", replacement), 200);
        policy(false, "0.1.0");
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", replacement), 401);
    }

    @Test
    void revokedDeviceAndInactiveStaffImmediatelyLosePrivateControl() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String control = startOutput(id, device.get("deviceToken").asText()).at("/payload/controlToken").asText();
        jdbc.sql("update iam.persons set status = 'DISABLED' where email = 'lecturer@example.test'").update();
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
        jdbc.sql("update iam.persons set status = 'ACTIVE' where email = 'lecturer@example.test'").update();
        json(delete("/api/v1/projection/devices/{id}", id)
                .header("Authorization", "Bearer " + lecturerToken), 204);
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
    }

    @Test
    void removedCourseMembershipInvalidatesPrivateControl() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String control = startOutput(id, device.get("deviceToken").asText()).at("/payload/controlToken").asText();
        jdbc.sql("delete from org.course_members where course_id = ?").param(courseId).update();
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
    }

    @Test
    void restoreRemainsAvailableAfterEndAndPolicyDisableWithoutRenewingPrivateControl() throws Exception {
        JsonNode device = readyWorkspaceDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        String control = startOutput(id, token).at("/payload/controlToken").asText();
        json(post(lectureControlPath() + "/end").header("X-Lecture-Control-Token", control), 200);
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
        policy(false, "0.2.0");
        JsonNode restore = noTargetCommand(id, "RESTORE_DISPLAYS", 202);
        JsonNode delivered = poll(token, "IDLE", null, SCREENS, 200);
        assertEquals(restore.get("id"), delivered.at("/commands/0/id"));
        assertEquals("RESTORE_DISPLAYS", delivered.at("/commands/0/type").asText());
        assertTrue(delivered.get("leaseUntil").isNull());
        assertTrue(delivered.get("mustStop").asBoolean());
        assertTrue(delivered.at("/commands/0/payload/controlToken").isNull());
        poll(token, "IDLE", ack(restore, "COMPLETED"), SCREENS, 200);
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
    }

    @Test
    void malformedUnknownAndAncientPrivateGrantsAreAuthenticationFailures() throws Exception {
        JsonNode device = readyWorkspaceDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        JsonNode start = startOutput(id, device.get("deviceToken").asText());
        String control = start.at("/payload/controlToken").asText();
        for (String invalid : List.of("bad", id + "." + "0".repeat(64), UUID.randomUUID() + "." + "0".repeat(64))) {
            json(get(lectureControlPath()).header("X-Lecture-Control-Token", invalid), 401);
        }
        jdbc.sql("update projection.commands set created_at = now() - interval '9 hours' where id = ?")
                .param(UUID.fromString(start.get("id").asText())).update();
        json(get(lectureControlPath()).header("X-Lecture-Control-Token", control), 401);
        noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 409);
    }

    @Test
    void reopeningPrivateRemoteReusesCurrentStartGrantsAndNeverReplacesPublicOutput() throws Exception {
        JsonNode device = readyWorkspaceDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 409);
        JsonNode test = command(id, "TEST_TARGET", false, null, UUID.randomUUID(), 202);
        poll(token, "IDLE", null, SCREENS, 200);
        poll(token, "TESTING", ack(test, "COMPLETED"), SCREENS, 200);
        noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 409);
        JsonNode start = startOutput(id, token);
        assertEquals(sessionId.toString(), settings(lecturerToken).at("/devices/0/activeSessionId").asText());
        JsonNode focus = noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 202);
        assertEquals(start.at("/payload/controlToken"), focus.at("/payload/controlToken"));
        assertEquals(start.at("/payload/projectionViewToken"), focus.at("/payload/projectionViewToken"));
        assertEquals(start.at("/payload/courseId"), focus.at("/payload/courseId"));
        assertEquals(start.at("/payload/sessionId"), focus.at("/payload/sessionId"));
        JsonNode delivered = poll(token, "SHOWING", null, SCREENS, 200);
        assertEquals(focus.get("id"), delivered.at("/commands/0/id"));
        assertEquals(start.at("/payload/controlToken"), delivered.at("/commands/0/payload/controlToken"));
        assertEquals(UUID.fromString(start.get("id").asText()), jdbc.sql(
                "select active_command_id from projection.devices where id = ?").param(id).query(UUID.class).single());
        assertFalse(delivered.get("leaseUntil").isNull());
        assertFalse(delivered.get("mustStop").asBoolean());
        JsonNode afterFailedFocus = poll(token, "SHOWING", ack(focus, "FAILED"), SCREENS, 200);
        assertFalse(afterFailedFocus.get("mustStop").asBoolean());
        assertFalse(afterFailedFocus.get("leaseUntil").isNull());
        json(get(lectureControlPath())
                .header("X-Lecture-Control-Token", start.at("/payload/controlToken").asText()), 200);
        UUID otherSession = UUID.fromString(startAnotherSession().get("id").asText());
        json(post("/api/v1/courses/{course}/sessions/{session}/projection/commands", courseId, otherSession)
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("deviceId", id, "requestId", UUID.randomUUID(),
                        "type", "FOCUS_PRIVATE_REMOTE"))), 409);
        jdbc.sql("update projection.devices set active_until = now() - interval '1 minute' where id = ?")
                .param(id).update();
        noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 409);
        policy(false, "0.1.0");
        noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 403);
        assertTrue(settings(lecturerToken).at("/devices/0/activeSessionId").isNull());
    }

    @Test
    void queuedPrivateRemoteCannotReopenAfterItsPublicLeaseExpires() throws Exception {
        JsonNode device = readyWorkspaceDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        startOutput(id, token);
        noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 202);
        jdbc.sql("update projection.devices set active_until = now() - interval '1 minute' where id = ?")
                .param(id).update();
        JsonNode expired = poll(token, "SHOWING", null, SCREENS, 200);
        assertTrue(expired.get("mustStop").asBoolean());
        assertEquals(0, expired.get("commands").size());
        assertTrue(expired.get("leaseUntil").isNull());
    }

    @Test
    void oldInstalledHelperMustUpgradeForWorkspaceButCanKeepItsLegacyPublicShow() throws Exception {
        JsonNode device = readyDevice();
        UUID id = UUID.fromString(device.get("deviceId").asText());
        String token = device.get("deviceToken").asText();
        for (String type : List.of(
                "PREPARE_DISPLAYS", "IDENTIFY_SCREENS", "RESTORE_DISPLAYS", "FOCUS_PRIVATE_REMOTE")) {
            noTargetCommand(id, type, 409);
        }
        JsonNode legacy = startOutput(id, token);
        noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 409);
        assertEquals(legacy.get("id").asText(), jdbc.sql(
                "select active_command_id from projection.devices where id = ?")
                .param(id).query(UUID.class).single().toString());
        deviceVersion = "0.2.0";
        poll(token, "SHOWING", null, SCREENS, 200);
        JsonNode upgraded = noTargetCommand(id, "FOCUS_PRIVATE_REMOTE", 202);
        assertEquals(legacy.at("/payload/controlToken"), upgraded.at("/payload/controlToken"));
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

    private void appearance(UUID deviceId, String jwt, String body, int expected) throws Exception {
        var request = put("/api/v1/projection/devices/{deviceId}/appearance", deviceId)
                .contentType(MediaType.APPLICATION_JSON).content(body);
        if (jwt != null) request.header("Authorization", "Bearer " + jwt);
        json(request, expected);
    }

    private String deviceStateWithoutTheme(UUID deviceId) {
        return jdbc.sql("select (to_jsonb(d) - 'remote_theme')::text from projection.devices d where id = ?")
                .param(deviceId).query(String.class).single();
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
        return pairWithIdentity(code, null, null, expected);
    }

    private JsonNode pairWithIdentity(String code, UUID installationId, String previousToken, int expected)
            throws Exception {
        Map<String, Object> body = new LinkedHashMap<>(Map.of("pairingCode", code, "name", "Room 12",
                "platform", "WINDOWS_X64", "version", deviceVersion, "osVersion", "10.0.26100",
                "protocolVersion", 1));
        if (installationId != null) body.put("installationId", installationId);
        if (previousToken != null) body.put("previousDeviceToken", previousToken);
        return json(post("/api/v1/projection/agent/pair").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)), expected);
    }

    private JsonNode readyDevice() throws Exception {
        policy(true, "0.1.0");
        JsonNode device = pair(pairing().get("pairingCode").asText(), 201);
        poll(device.get("deviceToken").asText(), "IDLE", null, SCREENS, 200);
        return device;
    }

    private JsonNode readyWorkspaceDevice() throws Exception {
        deviceVersion = "0.2.0";
        return readyDevice();
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

    private String lectureControlPath() {
        return "/api/v1/courses/" + courseId + "/sessions/" + sessionId;
    }

    private JsonNode noTargetCommand(UUID deviceId, String type, int expected) throws Exception {
        return json(post(lectureControlPath() + "/projection/commands")
                .header("Authorization", "Bearer " + lecturerToken).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("deviceId", deviceId,
                        "requestId", UUID.randomUUID(), "type", type))), expected);
    }

    private JsonNode poll(String token, String status, Map<String, Object> ack,
            List<Map<String, Object>> screens, int expected) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("version", deviceVersion);
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
