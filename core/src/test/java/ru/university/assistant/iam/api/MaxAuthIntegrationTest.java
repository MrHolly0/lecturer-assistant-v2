package ru.university.assistant.iam.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    void onlyALecturerCanRequestAMaxLinkCode() throws Exception {
        String studentToken = login(signed(701, Instant.now()), 200).get("accessToken").asText();

        mockMvc.perform(post("/api/v1/identity/max/link-codes")
                        .header("Authorization", "Bearer " + studentToken))
                .andExpect(status().isForbidden());
    }

    private String registerLecturer() throws Exception {
        String adminToken = json(post("/api/v1/auth/bootstrap-admin")
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
        return json(post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)),
                        expectedStatus);
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
