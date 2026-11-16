package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(
        properties = {
            "app.installation.enabled=true",
            "app.installation.operator-key=installation-isolated-test-key-with-enough-length"
        })
class InstallationUpdatesIntegrationTest extends LiveFlowTestBase {
    private static final String OPERATOR = "installation-isolated-test-key-with-enough-length";
    private static final KeyPair KEY = keyPair();
    private final UUID owner = UUID.randomUUID();
    private Map<String, Object> envelope;

    @DynamicPropertySource
    static void updateProperties(DynamicPropertyRegistry registry) {
        registry.add(
                "app.installation.release-public-key",
                () -> Base64.getEncoder().encodeToString(KEY.getPublic().getEncoded()));
    }

    private static KeyPair keyPair() {
        try {
            return KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    @BeforeEach
    void publishCatalog() throws Exception {
        jdbc.sql("truncate installation.jobs cascade").update();
        String payload =
                objectMapper.writeValueAsString(
                        Map.of(
                                "schema",
                                1,
                                "expiresAt",
                                Instant.now().plusSeconds(3600).toString(),
                                "releases",
                                List.of(
                                        Map.of(
                                                "id",
                                                "test-1",
                                                "version",
                                                "1.0.1",
                                                "notes",
                                                "Проверяемое обновление",
                                                "commit",
                                                "a".repeat(40),
                                                "databaseMin",
                                                0,
                                                "databaseMax",
                                                100,
                                                "backwardCompatible",
                                                true,
                                                "images",
                                                Map.of(
                                                        "core",
                                                                "example.test/core@sha256:"
                                                                        + "a".repeat(64),
                                                        "web",
                                                                "example.test/web@sha256:"
                                                                        + "b".repeat(64))))));
        Signature signature = Signature.getInstance("Ed25519");
        signature.initSign(KEY.getPrivate());
        signature.update(payload.getBytes(StandardCharsets.UTF_8));
        envelope =
                Map.of(
                        "kind",
                        "compose",
                        "payload",
                        payload,
                        "signature",
                        Base64.getEncoder().encodeToString(signature.sign()));
        json(
                post("/internal/v1/installation/catalog")
                        .header("X-Installation-Key", OPERATOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(envelope)),
                204);
    }

    private JsonNode request(String key, int expected) throws Exception {
        return json(
                post("/api/v1/admin/installation/jobs")
                        .header("Authorization", "Bearer " + adminToken)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"releaseId\":\"test-1\"}"),
                expected);
    }

    private JsonNode claim(UUID worker) throws Exception {
        return json(
                post("/internal/v1/installation/claim")
                        .header("X-Installation-Key", OPERATOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("owner", worker))),
                200);
    }

    private JsonNode stage(JsonNode job, String method, String stage, int expected)
            throws Exception {
        Map<String, Object> body =
                stage == null
                        ? Map.of("owner", owner, "fence", job.path("fence").asLong())
                        : Map.of(
                                "owner",
                                owner,
                                "fence",
                                job.path("fence").asLong(),
                                "stage",
                                stage,
                                "summary",
                                "Проверка");
        return json(
                post(
                                "/internal/v1/installation/jobs/{id}/{method}",
                                job.path("id").asText(),
                                method)
                        .header("X-Installation-Key", OPERATOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)),
                expected);
    }

    @Test
    void repeatedRequestsAndLostRepliesDoNotStartAnotherUpdateAndMaintenanceBlocksAdmission()
            throws Exception {
        JsonNode queued = request("same-request-key", 200);
        assertEquals(queued.path("id"), request("same-request-key", 200).path("id"));
        request("another-request-key", 409);
        JsonNode job = claim(owner).path("job");
        assertEquals("WAITING", stage(job, "prepare", null, 200).path("stage").asText());
        jdbc.sql("update live.sessions set status='ENDED',ended_at=now()").update();
        assertEquals("BACKING_UP", stage(job, "prepare", null, 200).path("stage").asText());
        assertEquals("BACKING_UP", stage(job, "prepare", null, 200).path("stage").asText());
        String groups = "{\"groups\":[{\"groupId\":\"" + groupId + "\"}]}";
        mockMvc.perform(
                        post(
                                        "/api/v1/courses/{courseId}/lectures/{lectureId}/sessions",
                                        courseId,
                                        lectureId)
                                .header("Authorization", "Bearer " + lecturerToken)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(groups))
                .andExpect(status().isServiceUnavailable());
        stage(job, "progress", "VERIFYING", 409);
        stage(job, "progress", "APPLYING", 200);
        stage(job, "progress", "APPLYING", 200);
        assertEquals(0, claim(UUID.randomUUID()).size());
        stage(job, "progress", "VERIFYING", 200);
        stage(job, "progress", "SUCCEEDED", 200);
        stage(job, "progress", "SUCCEEDED", 200);
        json(
                post(
                                "/api/v1/courses/{courseId}/lectures/{lectureId}/sessions",
                                courseId,
                                lectureId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(groups),
                201);
    }

    @Test
    void expiredOperatorIsNotReplacedAndAnUncertainUpdateNeedsAdministratorReview()
            throws Exception {
        request("request-lease-expiry", 200);
        JsonNode job = claim(owner).path("job");
        jdbc.sql("update installation.jobs set lease_until=now()-interval '1 second'").update();
        assertEquals(0, claim(UUID.randomUUID()).size());
        stage(job, "heartbeat", null, 409);
        request("request-after-expiry", 409);
        mockMvc.perform(
                        post(
                                        "/api/v1/admin/installation/jobs/{id}/acknowledge",
                                        job.path("id").asText())
                                .header("Authorization", "Bearer " + lecturerToken))
                .andExpect(status().isForbidden());
        json(
                post("/api/v1/admin/installation/jobs/{id}/acknowledge", job.path("id").asText())
                        .header("Authorization", "Bearer " + adminToken),
                204);
        request("request-after-review", 200);
    }

    @Test
    void catalogRequiresOperatorCredentialTrustedSignatureAndAdministrativeRole() throws Exception {
        mockMvc.perform(
                        post("/internal/v1/installation/catalog")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(envelope)))
                .andExpect(status().isUnauthorized());
        var modified = new java.util.HashMap<>(envelope);
        modified.put("payload", envelope.get("payload").toString().replace("1.0.1", "1.0.2"));
        mockMvc.perform(
                        post("/internal/v1/installation/catalog")
                                .header("X-Installation-Key", OPERATOR)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(modified)))
                .andExpect(status().isBadRequest());
        mockMvc.perform(
                        get("/api/v1/admin/installation")
                                .header("Authorization", "Bearer " + lecturerToken))
                .andExpect(status().isForbidden());
        JsonNode state =
                json(
                        get("/api/v1/admin/installation")
                                .header("Authorization", "Bearer " + adminToken),
                        200);
        assertEquals(1, state.path("releases").size());
        assertEquals(56L, state.path("databaseVersion").asLong());
        JsonNode queued = request("cancel-before-apply", 200);
        json(
                post("/api/v1/admin/installation/jobs/{id}/cancel", queued.path("id").asText())
                        .header("Authorization", "Bearer " + adminToken),
                204);
    }

    @Test
    void uncertainApplyKeepsAdmissionClosedAfterLeaseExpiresUntilAdministratorReview()
            throws Exception {
        request("request-uncertain-apply", 200);
        JsonNode job = claim(owner).path("job");
        jdbc.sql("update live.sessions set status='ENDED',ended_at=now()").update();
        stage(job, "prepare", null, 200);
        stage(job, "progress", "APPLYING", 200);
        jdbc.sql(
                        "update installation.jobs set lease_until=now()-interval '1"
                        + " second',maintenance_until=now()-interval '1 second'")
                .update();
        String groups = "{\"groups\":[{\"groupId\":\"" + groupId + "\"}]}";
        mockMvc.perform(
                        post(
                                        "/api/v1/courses/{courseId}/lectures/{lectureId}/sessions",
                                        courseId,
                                        lectureId)
                                .header("Authorization", "Bearer " + lecturerToken)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(groups))
                .andExpect(status().isServiceUnavailable());
        claim(owner);
        stage(job, "progress", "VERIFYING", 409);
        json(
                post("/api/v1/admin/installation/jobs/{id}/acknowledge", job.path("id").asText())
                        .header("Authorization", "Bearer " + adminToken),
                204);
        json(
                post(
                                "/api/v1/courses/{courseId}/lectures/{lectureId}/sessions",
                                courseId,
                                lectureId)
                        .header("Authorization", "Bearer " + lecturerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(groups),
                201);
    }

    @Test
    void externalOperatorUsesPublicApiPrefixWithItsOwnCredential() throws Exception {
        String body = objectMapper.writeValueAsString(envelope);
        mockMvc.perform(
                        post("/api/v1/installation-operator/catalog")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isUnauthorized());
        json(
                post("/api/v1/installation-operator/catalog")
                        .header("X-Installation-Key", OPERATOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body),
                204);
        json(
                post("/api/v1/installation-operator/claim")
                        .header("X-Installation-Key", OPERATOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("owner", owner))),
                200);
    }
}
