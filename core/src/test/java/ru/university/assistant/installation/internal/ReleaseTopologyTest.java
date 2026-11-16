package ru.university.assistant.installation.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ReleaseTopologyTest {
    @Test
    void legacyAndDifferentTopologiesRejectTheSameSchemaRelease() throws Exception {
        var keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        var json = new ObjectMapper();
        String publicKey = Base64.getEncoder().encodeToString(keys.getPublic().getEncoded());
        String payload =
                json.writeValueAsString(
                        Map.of(
                                "schema",
                                1,
                                "expiresAt",
                                Instant.now().plusSeconds(3600).toString(),
                                "releases",
                                List.of(
                                        Map.of(
                                                "id",
                                                "reviewed",
                                                "version",
                                                "2.0",
                                                "notes",
                                                "Fixture",
                                                "commit",
                                                "a".repeat(40),
                                                "backwardCompatible",
                                                false,
                                                "requiredTopology",
                                                "single-vm-v2",
                                                "databaseMin",
                                                56,
                                                "databaseMax",
                                                56,
                                                "images",
                                                Map.of(
                                                        "core",
                                                        "example/core@sha256:" + "b".repeat(64),
                                                        "web",
                                                        "example/web@sha256:" + "c".repeat(64))))));
        var signer = Signature.getInstance("Ed25519");
        signer.initSign(keys.getPrivate());
        signer.update(payload.getBytes(StandardCharsets.UTF_8));
        String signature = Base64.getEncoder().encodeToString(signer.sign());
        for (String topology : List.of("", "single-vm-v1"))
            assertThrows(
                    ResponseStatusException.class,
                    () -> new ReleaseCatalog(publicKey, json, topology).verify(payload, signature));
        assertEquals(
                "reviewed",
                new ReleaseCatalog(publicKey, json, "single-vm-v2")
                        .verify(payload, signature)
                        .path("releases")
                        .get(0)
                        .path("id")
                        .asText());
    }
}
