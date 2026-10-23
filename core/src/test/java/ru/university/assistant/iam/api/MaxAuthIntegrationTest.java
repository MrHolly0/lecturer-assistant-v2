package ru.university.assistant.iam.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import ru.university.assistant.iam.internal.MaxInitDataSigner;

@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
class MaxAuthIntegrationTest {
    private static final String BOT_TOKEN = "integration-bot-token-not-a-secret";
    private static final String ADMIN_SETUP_TOKEN = "integration-admin-setup-token-with-enough-length";

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    JdbcClient jdbc;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("app.security.jwt-secret", () -> "integration-test-secret-with-enough-length");
        registry.add("app.max.bot-token", () -> BOT_TOKEN);
        registry.add("app.security.admin-setup-token", () -> ADMIN_SETUP_TOKEN);
    }

    @BeforeEach
    void reset() {
        jdbc.sql(
                        """
                        truncate table
                            analytics.outbox, analytics.events,
                            iam.max_link_codes, iam.channel_identities, iam.refresh_tokens,
                            iam.invitations, iam.persons
                        restart identity cascade
                        """)
                .update();
    }

    @Test
    void validInitDataIssuesJwtForNewStudent() throws Exception {
        JsonNode body = login(signed(101, Instant.now()), 200);

        assertEquals("STUDENT", body.get("role").asText());
        assertEquals("Иван Петров", body.get("displayName").asText());
        UUID.fromString(body.get("personId").asText());
        assertEquals(true, body.get("expiresIn").asLong() > 0);

        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + body.get("accessToken").asText()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(body.get("personId").asText()));
    }

    @Test
    void forgedSignatureIsRejectedAndCreatesNobody() throws Exception {
        login(MaxInitDataSigner.sign("someone-elses-token", params(101, Instant.now())), 401);

        assertEquals(0L, count("iam.persons"));
    }

    @Test
    void expiredAuthDateIsRejected() throws Exception {
        login(signed(101, Instant.now().minus(Duration.ofHours(2))), 401);

        assertEquals(0L, count("iam.persons"));
    }

    @Test
    void maxSessionRotatesWithoutRevalidatingAnExpiredLaunchAndWithoutUsingBrowserCookie() throws Exception {
        registerLecturer();
        var browserLogin = mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"lecturer@example.test\",\"password\":\"password-123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse();
        Cookie browserCookie = browserLogin.getCookie("la_refresh");
        assertTrue(browserLogin.getHeader("Set-Cookie").contains("SameSite=Strict"));

        var maxLogin = mockMvc.perform(post("/api/v1/auth/max")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("initData", signed(9901, Instant.now())))))
                .andExpect(status().isOk()).andReturn().getResponse();
        String maxPerson = objectMapper.readTree(maxLogin.getContentAsString()).get("personId").asText();
        String header = maxLogin.getHeader("Set-Cookie");
        assertTrue(header.contains("la_max_refresh="));
        assertTrue(header.contains("HttpOnly"));
        assertTrue(header.contains("Secure"));
        assertTrue(header.contains("SameSite=None"));
        assertTrue(header.contains("Partitioned"));
        assertFalse(maxLogin.getContentAsString().contains("refreshToken"));
        Cookie initial = maxLogin.getCookie("la_max_refresh");
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(initial)).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/auth/refresh").header("X-Auth-Channel", "unknown").cookie(initial))
                .andExpect(status().isBadRequest());
        mockMvc.perform(options("/api/v1/auth/refresh")
                .header("Origin", "https://untrusted.example")
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "X-Auth-Channel"))
                .andExpect(status().isForbidden());
        login(signed(9901, Instant.now().minus(Duration.ofHours(2))), 401);
        var rotated = mockMvc.perform(post("/api/v1/auth/refresh")
                .header("X-Auth-Channel", "max").cookie(initial, browserCookie))
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.id").value(maxPerson))
                .andReturn().getResponse();
        mockMvc.perform(post("/api/v1/auth/refresh")
                .header("X-Auth-Channel", "max").cookie(initial)).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(browserCookie))
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.role").value("LECTURER"));
        mockMvc.perform(post("/api/v1/auth/logout")
                .header("X-Auth-Channel", "max")
                .header("Authorization", "Bearer " + objectMapper.readTree(rotated.getContentAsString())
                        .get("accessToken").asText())
                .cookie(rotated.getCookie("la_max_refresh")))
                .andExpect(status().isNoContent());
        mockMvc.perform(post("/api/v1/auth/refresh")
                .header("X-Auth-Channel", "max").cookie(rotated.getCookie("la_max_refresh")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void repeatedLoginOfSameMaxUserDoesNotCreateSecondPerson() throws Exception {
        String first = login(signed(101, Instant.now()), 200).get("personId").asText();
        String second = login(signed(101, Instant.now()), 200).get("personId").asText();
        String third = login(signed(101, Instant.now()), 200).get("personId").asText();

        assertEquals(first, second);
        assertEquals(first, third);
        assertEquals(1L, count("iam.persons"));
        assertEquals(1L, count("iam.channel_identities"));
        assertEquals(
                "max",
                jdbc.sql("select channel_type from iam.channel_identities").query(String.class).single());
    }

    @Test
    void legacyMaxEmailCollisionDoesNotBlockLoginOrGrantTheExistingAccountsRole() throws Exception {
        String lecturerToken = registerLecturer();
        String lecturerId = json(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + lecturerToken), 200)
                .get("id").asText();
        jdbc.sql("update iam.persons set email = 'max-701@max.local' where id = :id")
                .param("id", UUID.fromString(lecturerId)).update();

        JsonNode student = login(signed(701, Instant.now()), 200);

        assertEquals("STUDENT", student.get("role").asText());
        assertEquals(false, lecturerId.equals(student.get("personId").asText()));
        assertEquals(student.get("personId").asText(),
                login(signed(701, Instant.now()), 200).get("personId").asText());
        assertEquals("LECTURER", jdbc.sql("select role from iam.persons where id = :id")
                .param("id", UUID.fromString(lecturerId)).query(String.class).single());
    }

    @Test
    void unlinkingReboundLegacyMaxIdentityAllowsANewStudentWithoutReclaimingOldProfiles() throws Exception {
        String formerStudentId = login(signed(701, Instant.now()), 200).get("personId").asText();
        jdbc.sql("update iam.persons set email = 'max-701@max.local' where id = :id")
                .param("id", UUID.fromString(formerStudentId)).update();
        String lecturerToken = registerLecturer();
        JsonNode lecturer = loginWithCode(signed(701, Instant.now()), requestMaxLinkCode(lecturerToken), 200);
        mockMvc.perform(delete("/api/v1/identity/max")
                        .header("Authorization", "Bearer " + lecturerToken))
                .andExpect(status().isNoContent());

        JsonNode student = login(signed(701, Instant.now()), 200);

        assertEquals("STUDENT", student.get("role").asText());
        assertEquals(false, formerStudentId.equals(student.get("personId").asText()));
        assertEquals(false, lecturer.get("personId").asText().equals(student.get("personId").asText()));
        assertEquals(4L, count("iam.persons"));
        assertEquals(1L, count("iam.channel_identities where channel_type = 'max'"));
        assertEquals(0L, count("iam.channel_identities where person_id = '" + formerStudentId + "'"));
    }

    @Test
    void existingOnlyDoesNotCreateAnAccountForUnknownMaxUser() throws Exception {
        json(post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "initData", signed(601, Instant.now()), "existingOnly", true))),
                404);

        assertEquals(0L, count("iam.persons"));
        assertEquals(0L, count("iam.channel_identities"));
    }

    @Test
    void differentMaxUsersGetDifferentPeople() throws Exception {
        String a = login(signed(101, Instant.now()), 200).get("personId").asText();
        String b = login(signed(102, Instant.now()), 200).get("personId").asText();

        assertEquals(false, a.equals(b));
        assertEquals(2L, count("iam.persons"));
    }

    @Test
    void parallelFirstLoginsOfSameUserCreateOnePerson() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Callable<String>> calls = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                calls.add(() -> login(signed(555, Instant.now()), 200).get("personId").asText());
            }
            Set<String> ids = new java.util.HashSet<>();
            for (Future<String> future : pool.invokeAll(calls)) {
                ids.add(future.get());
            }
            assertEquals(1, ids.size());
            assertEquals(1L, count("iam.persons"));
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void disabledPersonCannotLogIn() throws Exception {
        login(signed(101, Instant.now()), 200);
        jdbc.sql("update iam.persons set status = 'DISABLED'").update();

        login(signed(101, Instant.now()), 403);
    }

    @Test
    void blankInitDataIsBadRequest() throws Exception {
        mockMvc.perform(post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"initData\":\"\"}"))
                .andExpect(status().isBadRequest());
    }

    // ---- B-03: привязка MAX-аккаунта к преподавателю ----

    @Test
    void lecturerLinkingMaxAccountWithValidCodeGetsLecturerRoleAndNoNewPerson() throws Exception {
        String lecturerToken = registerLecturer();
        String lecturerId = json(get("/api/v1/auth/me").header("Authorization", "Bearer " + lecturerToken), 200)
                .get("id")
                .asText();
        String code = requestMaxLinkCode(lecturerToken);

        JsonNode body = loginWithCode(signed(701, Instant.now()), code, 200);

        assertEquals("LECTURER", body.get("role").asText());
        assertEquals(lecturerId, body.get("personId").asText());
        assertEquals(2L, count("iam.persons")); // admin + lecturer, ни одного нового
        assertEquals(1L, count("iam.channel_identities where channel_type = 'max'"));
        assertEquals(
                lecturerId,
                jdbc.sql("select person_id from iam.channel_identities where channel_type = 'max'")
                        .query(String.class)
                        .single());
    }

    @Test
    void secondMaxLoginOfLinkedLecturerReusesRoleWithoutCode() throws Exception {
        String lecturerToken = registerLecturer();
        String code = requestMaxLinkCode(lecturerToken);
        loginWithCode(signed(701, Instant.now()), code, 200);

        JsonNode again = login(signed(701, Instant.now()), 200); // без linkCode

        assertEquals("LECTURER", again.get("role").asText());
        assertEquals(2L, count("iam.persons"));

        JsonNode onAnotherDevice = json(post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "initData", signed(701, Instant.now()), "existingOnly", true))),
                200);
        assertEquals("LECTURER", onAnotherDevice.get("role").asText());
        assertEquals(2L, count("iam.persons"));
    }

    @Test
    void validCodeMovesAnExistingMaxBindingToAnotherAccount() throws Exception {
        String formerStudentId = login(signed(701, Instant.now()), 200).get("personId").asText();
        String lecturerToken = registerLecturer();
        String lecturerId = json(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + lecturerToken), 200)
                .get("id").asText();
        String code = requestMaxLinkCode(lecturerToken);

        JsonNode switched = loginWithCode(signed(701, Instant.now()), code, 200);

        assertEquals("LECTURER", switched.get("role").asText());
        assertEquals(lecturerId, switched.get("personId").asText());
        assertEquals(lecturerId, login(signed(701, Instant.now()), 200).get("personId").asText());
        assertEquals(3L, count("iam.persons"));
        assertEquals(1L, count("iam.channel_identities where channel_type = 'max'"));
        assertEquals(0L, count("iam.channel_identities where person_id = '" + formerStudentId + "'"));
        loginWithCode(signed(701, Instant.now()), code, 409);
    }

    @Test
    void promotedStudentKeepsTheirMaxAccountAndGetsLecturerAccess() throws Exception {
        String adminToken = json(post("/api/v1/auth/bootstrap-admin")
                        .header("X-Admin-Setup-Token", ADMIN_SETUP_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Admin\",\"email\":\"admin@example.test\","
                                + "\"password\":\"password-123\"}"), 200)
                .get("accessToken").asText();
        String studentId = login(signed(701, Instant.now()), 200).get("personId").asText();

        mockMvc.perform(put("/api/v1/admin/users/{personId}/role", studentId)
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"LECTURER\"}"))
                .andExpect(status().isOk());

        JsonNode promoted = login(signed(701, Instant.now()), 200);
        assertEquals(studentId, promoted.get("personId").asText());
        assertEquals("LECTURER", promoted.get("role").asText());
        assertEquals(2L, count("iam.persons"));
    }

    @Test
    void accountAlreadyLinkedToAnotherMaxCannotBeTakenOver() throws Exception {
        String lecturerToken = registerLecturer();
        loginWithCode(signed(701, Instant.now()), requestMaxLinkCode(lecturerToken), 200);
        String secondCode = requestMaxLinkCode(lecturerToken);

        loginWithCode(signed(702, Instant.now()), secondCode, 409);

        assertEquals(1L, count("iam.channel_identities where channel_type = 'max'"));
        assertEquals(2L, count("iam.persons"));
        assertEquals("LECTURER", login(signed(701, Instant.now()), 200).get("role").asText());
    }

    @Test
    void userCanUnlinkOnlyTheirOwnMaxIdentity() throws Exception {
        String lecturerToken = registerLecturer();
        loginWithCode(signed(701, Instant.now()), requestMaxLinkCode(lecturerToken), 200);
        login(signed(702, Instant.now()), 200);

        mockMvc.perform(get("/api/v1/identity/max")
                        .header("Authorization", "Bearer " + lecturerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(true));

        mockMvc.perform(delete("/api/v1/identity/max")
                        .header("Authorization", "Bearer " + lecturerToken))
                .andExpect(status().isNoContent());

        assertEquals(0L, count("iam.channel_identities where external_id = '701'"));
        assertEquals(1L, count("iam.channel_identities where external_id = '702'"));
        mockMvc.perform(get("/api/v1/identity/max")
                        .header("Authorization", "Bearer " + lecturerToken))
                .andExpect(jsonPath("$.connected").value(false));
    }

    @Test
    void reusingAnAlreadyConsumedCodeIsRejectedWithConflict() throws Exception {
        String lecturerToken = registerLecturer();
        String code = requestMaxLinkCode(lecturerToken);
        loginWithCode(signed(701, Instant.now()), code, 200);

        // другой MAX-пользователь тем же кодом — код уже использован, не «повторный вход»
        loginWithCode(signed(702, Instant.now()), code, 409);

        assertEquals(2L, count("iam.persons")); // второй MAX-пользователь студентом тоже не стал
        assertEquals(1L, count("iam.channel_identities where channel_type = 'max'"));
    }

    @Test
    void expiredCodeIsRejectedAsBadRequest() throws Exception {
        String lecturerToken = registerLecturer();
        String code = requestMaxLinkCode(lecturerToken);
        jdbc.sql("update iam.max_link_codes set expires_at = now() - interval '1 minute' where code = :code")
                .param("code", code)
                .update();

        loginWithCode(signed(701, Instant.now()), code, 400);

        assertEquals(2L, count("iam.persons")); // admin + преподаватель, студент из-за плохого кода не создан
    }

    @Test
    void unknownCodeIsRejectedAsBadRequest() throws Exception {
        loginWithCode(signed(701, Instant.now()), "ZZZZZZ", 400);

        assertEquals(0L, count("iam.persons"));
    }

    @Test
    void loginWithoutCodeStillCreatesAStudent() throws Exception {
        JsonNode body = login(signed(701, Instant.now()), 200);

        assertEquals("STUDENT", body.get("role").asText());
        assertEquals(1L, count("iam.persons"));
    }

    @Test
    void aStudentCannotRequestAMaxLinkCode() throws Exception {
        String studentToken = login(signed(701, Instant.now()), 200).get("accessToken").asText();

        mockMvc.perform(post("/api/v1/identity/max/link-codes")
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void anAdminCanLinkTheirOwnMaxAccountWithoutChangingRole() throws Exception {
        String adminToken = json(post("/api/v1/auth/bootstrap-admin")
                        .header("X-Admin-Setup-Token", ADMIN_SETUP_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Admin\",\"email\":\"admin@example.test\","
                                + "\"password\":\"password-123\"}"),
                        200)
                .get("accessToken")
                .asText();
        String code = requestMaxLinkCode(adminToken);

        JsonNode linked = loginWithCode(signed(701, Instant.now()), code, 200);

        assertEquals("ADMIN", linked.get("role").asText());
        assertEquals(1L, count("iam.persons"));
    }

    @Test
    void previewWithCredentialsDoesNotChangeIdentityOrIssueSession() throws Exception {
        String formerId = login(signed(801, Instant.now()), 200).get("personId").asText();
        registerLecturer();
        long tokens = count("iam.refresh_tokens");
        JsonNode review = preview(signed(801, Instant.now()),
                Map.of("email", "lecturer@example.test", "password", "password-123"), 200);
        assertEquals(formerId, review.get("currentAccount").get("id").asText());
        assertEquals("LECTURER", review.get("targetAccount").get("role").asText());
        assertEquals(false, review.get("alreadyLinked").asBoolean());
        assertEquals(tokens, count("iam.refresh_tokens"));
        assertEquals(formerId, login(signed(801, Instant.now()), 200).get("personId").asText());
        JsonNode confirmed = confirm(signed(801, Instant.now()), review.get("confirmationToken").asText(), 200);
        assertEquals(review.get("targetAccount").get("id").asText(), confirmed.get("personId").asText());
        mockMvc.perform(get("/api/v1/identity/max")
                        .header("Authorization", "Bearer " + confirmed.get("accessToken").asText()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.connected").value(true));
        JsonNode nextLogin = json(post("/api/v1/auth/max").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "initData", signed(801, Instant.now()), "existingOnly", true))), 200);
        assertEquals(confirmed.get("personId"), nextLogin.get("personId"));
        assertEquals("LECTURER", nextLogin.get("role").asText());
        confirm(signed(801, Instant.now()), review.get("confirmationToken").asText(), 409);
    }

    @Test
    void reviewingTheSameLinkedAccountOnlyIssuesASessionAndRejectsIdentityDrift() throws Exception {
        String lecturerToken = registerLecturer();
        String init = signed(806, Instant.now());
        JsonNode linked = loginWithCode(init, requestMaxLinkCode(lecturerToken), 200);
        List<Map<String, Object>> identitiesBefore = jdbc.sql("select * from iam.channel_identities")
                .query().listOfRows();

        for (Map<String, String> proof : List.of(
                Map.of("email", "lecturer@example.test", "password", "password-123"),
                Map.of("linkCode", requestMaxLinkCode(lecturerToken)))) {
            JsonNode review = preview(init, proof, 200);
            assertTrue(review.get("alreadyLinked").asBoolean());
            assertEquals(review.get("currentAccount").get("id"), review.get("targetAccount").get("id"));
            JsonNode resumed = confirm(init, review.get("confirmationToken").asText(), 200);
            assertEquals(linked.get("personId"), resumed.get("personId"));
            assertEquals("LECTURER", resumed.get("role").asText());
            assertEquals(identitiesBefore, jdbc.sql("select * from iam.channel_identities").query().listOfRows());
        }

        preview(init, Map.of("email", "lecturer@example.test", "password", "incorrect"), 401);
        JsonNode review = preview(init,
                Map.of("email", "lecturer@example.test", "password", "password-123"), 200);
        mockMvc.perform(delete("/api/v1/identity/max")
                        .header("Authorization", "Bearer " + linked.get("accessToken").asText()))
                .andExpect(status().isNoContent());
        confirm(init, review.get("confirmationToken").asText(), 409);
        assertEquals(0L, count("iam.channel_identities"));
    }

    @Test
    void confirmationIsBoundToSignedMaxIdAndAccountVersion() throws Exception {
        registerLecturer();
        JsonNode review = preview(signed(802, Instant.now()),
                Map.of("email", "lecturer@example.test", "password", "password-123"), 200);
        String token = review.get("confirmationToken").asText();
        confirm(signed(803, Instant.now()), token, 409);
        jdbc.sql("update iam.persons set auth_version = auth_version + 1 "
                + "where email = 'lecturer@example.test'").update();
        confirm(signed(802, Instant.now()), token, 409);
        assertEquals(0L, count("iam.channel_identities"));
    }

    @Test
    void confirmationRejectsIdentityDriftAndExpiry() throws Exception {
        String lecturerToken = registerLecturer();
        String init = signed(804, Instant.now());
        JsonNode review = preview(init, Map.of("email", "lecturer@example.test", "password", "password-123"), 200);
        login(init, 200); // A new current identity after review requires another review.
        confirm(init, review.get("confirmationToken").asText(), 409);
        JsonNode next = preview(init, Map.of("linkCode", requestMaxLinkCode(lecturerToken)), 200);
        jdbc.sql("update iam.max_link_confirmations set expires_at = now() - interval '1 second'").update();
        confirm(init, next.get("confirmationToken").asText(), 409);
        assertEquals("STUDENT", login(init, 200).get("role").asText());
    }

    @Test
    void parallelConfirmationsConsumeOnce() throws Exception {
        registerLecturer();
        String init = signed(805, Instant.now());
        String token = preview(init, Map.of("email", "lecturer@example.test", "password", "password-123"), 200)
                .get("confirmationToken").asText();
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            List<Callable<Integer>> calls = List.of(
                    () -> confirmationStatus(init, token), () -> confirmationStatus(init, token));
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> result : pool.invokeAll(calls)) statuses.add(result.get());
            statuses.sort(Integer::compareTo);
            assertEquals(List.of(200, 409), statuses);
        }
        assertEquals(1L, count("iam.channel_identities"));
    }

    @Test
    void legacyMaxLinkingCannotBypassReviewOrSignature() throws Exception {
        String lecturerToken = registerLecturer();
        String code = requestMaxLinkCode(lecturerToken);
        json(post("/api/v1/auth/max").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "initData", signed(806, Instant.now()), "linkCode", code))), 409);
        JsonNode legacy = json(post("/api/v1/identity/link-codes")
                .header("Authorization", "Bearer " + lecturerToken), 201);
        json(post("/api/v1/identity/link").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "channelType", "max", "externalId", "806", "code", legacy.get("code").asText()))), 400);
        assertEquals(0L, count("iam.channel_identities"));
    }

    private int confirmationStatus(String init, String token) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/max/link-confirm").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("initData", init, "confirmationToken", token))))
                .andReturn().getResponse().getStatus();
    }

    private String registerLecturer() throws Exception {
        String adminToken = json(post("/api/v1/auth/bootstrap-admin")
                        .header("X-Admin-Setup-Token", ADMIN_SETUP_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Admin\",\"email\":\"admin@example.test\","
                                + "\"password\":\"password-123\"}"),
                        200)
                .get("accessToken")
                .asText();
        String invite = json(post("/api/v1/admin/invitations")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"LECTURER\"}"),
                        201)
                .get("code")
                .asText();
        return json(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"invitationCode\":\"" + invite + "\",\"displayName\":\"Lecturer\","
                                + "\"email\":\"lecturer@example.test\",\"password\":\"password-123\"}"),
                        200)
                .get("accessToken")
                .asText();
    }

    private String requestMaxLinkCode(String lecturerToken) throws Exception {
        JsonNode response = json(post("/api/v1/identity/max/link-codes")
                        .header("Authorization", "Bearer " + lecturerToken),
                        201);
        String code = response.get("code").asText();
        assertEquals(6, code.length());
        return code;
    }

    private Map<String, String> params(long userId, Instant authDate) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("auth_date", String.valueOf(authDate.getEpochSecond()));
        params.put("query_id", "q-" + userId);
        params.put("user", MaxInitDataSigner.userJson(userId, "Иван", "Петров"));
        return params;
    }

    private String signed(long userId, Instant authDate) {
        return MaxInitDataSigner.sign(BOT_TOKEN, params(userId, authDate));
    }

    private JsonNode login(String initData, int expectedStatus) throws Exception {
        return loginWithCode(initData, null, expectedStatus);
    }

    private JsonNode loginWithCode(String initData, String linkCode, int expectedStatus) throws Exception {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("initData", initData);
        if (linkCode != null) {
            body.put("linkCode", linkCode);
        }
        if (linkCode != null) {
            JsonNode review = json(post("/api/v1/auth/max/link-preview")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(body)), expectedStatus == 200 ? 200 : expectedStatus);
            if (expectedStatus != 200) return review;
            return confirm(initData, review.get("confirmationToken").asText(), 200);
        }
        return json(post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)), expectedStatus);
    }

    private JsonNode confirm(String initData, String token, int status) throws Exception {
        return json(post("/api/v1/auth/max/link-confirm").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "initData", initData, "confirmationToken", token))), status);
    }

    private JsonNode preview(String initData, Map<String, String> proof, int status) throws Exception {
        Map<String, String> body = new LinkedHashMap<>(proof);
        body.put("initData", initData);
        return json(post("/api/v1/auth/max/link-preview").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)), status);
    }


    private JsonNode json(org.springframework.test.web.servlet.RequestBuilder request, int expectedStatus)
            throws Exception {
        var result = mockMvc.perform(request).andExpect(status().is(expectedStatus)).andReturn();
        String response = result.getResponse().getContentAsString();
        return response.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(response);
    }

    private long count(String table) {
        return jdbc.sql("select count(*) from " + table).query(Long.class).single();
    }
}
