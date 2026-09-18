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
        jdbc.sql("truncate table iam.channel_identities, iam.refresh_tokens, iam.persons restart identity cascade")
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
        String content = objectMapper.writeValueAsString(Map.of("initData", initData));
        var result = mockMvc.perform(post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(content))
                .andExpect(status().is(expectedStatus))
                .andReturn();
        String response = result.getResponse().getContentAsString();
        return response.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(response);
    }

    private long count(String table) {
        return jdbc.sql("select count(*) from " + table).query(Long.class).single();
    }
}
