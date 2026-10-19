package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import ru.university.assistant.projection.internal.ProjectionReleaseCatalog;

/** Actual signed catalog plus HTTP/persistence: an OS upgrade must not require pairing again. */
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ProjectionReleaseApiIntegrationTest extends LiveFlowTestBase {
    private static final Path DIRECTORY = directory();
    @Autowired ProjectionReleaseCatalog releases;

    @DynamicPropertySource
    static void releaseProperties(DynamicPropertyRegistry registry) {
        registry.add("app.projection.releases.catalog-path", () -> DIRECTORY.resolve("catalog.json").toString());
        registry.add("app.projection.releases.trust-path", () -> DIRECTORY.resolve("trust.json").toString());
    }

    @Test
    void nextPollRefreshesNumericOsAndReceivesCompatibleReleaseWithoutPairingAgain() throws Exception {
        jdbc.sql("delete from projection.release_checkpoints").update();
        jdbc.sql("""
                insert into projection.policy(singleton, agent_allowed) values (true, true)
                on conflict(singleton) do update set agent_allowed = true, minimum_version = '0.1.0'
                """).update();
        publishCatalog();
        releases.refresh();
        JsonNode pairing = json(post("/api/v1/projection/pairings")
                .header("Authorization", "Bearer " + lecturerToken), 201);
        JsonNode paired = json(post("/api/v1/projection/agent/pair").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("pairingCode", pairing.path("pairingCode").asText(),
                        "name", "Mac", "platform", "MACOS_ARM64", "version", "0.1.0", "osVersion", "14.0.0",
                        "protocolVersion", 1))), 201);
        String token = paired.path("deviceToken").asText();
        assertTrue(poll(token, null, 200).path("release").isNull());
        JsonNode upgraded = poll(token, "15.0.0", 200);
        assertEquals("release-v1", upgraded.path("release").path("keyId").asText());
        assertEquals("15.0.0", jdbc.sql("select os_version from projection.devices").query(String.class).single());
        assertEquals(upgraded.path("release"), poll(token, "", 200).path("release"));
        assertEquals(upgraded.path("release"), poll(token, null, 200).path("release"));
        poll(token, "macOS 15", 400);
        assertEquals("15.0.0", jdbc.sql("select os_version from projection.devices").query(String.class).single());
    }

    private JsonNode poll(String token, String os, int expected) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("version", "0.1.0"); body.put("protocolVersion", 1);
        body.put("status", "IDLE"); body.put("screens", List.of());
        if (os != null) body.put("osVersion", os);
        return json(post("/api/v1/projection/agent/poll").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body)), expected);
    }

    private void publishCatalog() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        var key = generator.generateKeyPair();
        Map<String, Object> manifest = new LinkedHashMap<>();
        manifest.put("sequence", 100); manifest.put("version", "2.0.0");
        manifest.put("platform", "MACOS_ARM64"); manifest.put("artifactType", "UPDATE");
        manifest.put("minimumOsVersion", "15.0.0"); manifest.put("protocolVersion", 1);
        manifest.put("publishedAt", Instant.now().minusSeconds(60).toString());
        manifest.put("expiresAt", Instant.now().plusSeconds(3600).toString());
        manifest.put("url", "https://github.com/institution/projector-agent/releases/download/v2/macos.zip");
        manifest.put("size", 100); manifest.put("sha256", "a".repeat(64));
        manifest.put("entryPoint", "app/Projector.Agent");
        byte[] payload = objectMapper.writeValueAsBytes(manifest);
        Signature signature = Signature.getInstance("SHA256withECDSAinP1363Format");
        signature.initSign(key.getPrivate()); signature.update(payload);
        Map<String, Object> envelope = Map.of("keyId", "release-v1",
                "payload", Base64.getEncoder().encodeToString(payload),
                "signature", Base64.getEncoder().encodeToString(signature.sign()));
        Files.write(DIRECTORY.resolve("trust.json"), objectMapper.writeValueAsBytes(Map.of(
                "repository", "institution/projector-agent", "keys", Map.of("release-v1",
                        Base64.getEncoder().encodeToString(key.getPublic().getEncoded())))));
        Files.write(DIRECTORY.resolve("catalog.json"), objectMapper.writeValueAsBytes(Map.of(
                "schemaVersion", 1, "releases", List.of(envelope))));
    }

    private static Path directory() {
        try { return Files.createTempDirectory("projection-release-api-"); }
        catch (java.io.IOException exception) { throw new IllegalStateException(exception); }
    }
}
