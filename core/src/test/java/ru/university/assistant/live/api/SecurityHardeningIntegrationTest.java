package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import ru.university.assistant.iam.internal.MaxInitDataSigner;

/**
 * B-13, минимум: CORS ограничен списком адресов (не "*"), вход через MAX и отправка сигналов
 * ограничены по частоте. Отдельный набор свойств (маленькие лимиты) — своя, не общая с остальными
 * наследниками LiveFlowTestBase порция Spring-контекста.
 */
class SecurityHardeningIntegrationTest extends LiveFlowTestBase {
    private static final String ALLOWED_ORIGIN = "http://localhost:5173";
    private static final String DISALLOWED_ORIGIN = "https://evil.example";

    @DynamicPropertySource
    static void rateLimits(DynamicPropertyRegistry registry) {
        registry.add("app.security.rate-limit.auth-max-per-minute", () -> "3");
        registry.add("app.security.rate-limit.signal-per-minute", () -> "3");
    }

    @org.springframework.beans.factory.annotation.Autowired
    org.springframework.context.ApplicationContext context;

    @Test
    void refreshCleanupHasABoundedBatchForLargeExpiredBacklogs() {
        var person =
                jdbc.sql("select id from iam.persons where role='LECTURER' limit 1")
                        .query(java.util.UUID.class)
                        .single();
        jdbc.sql(
                        """
            insert into iam.refresh_tokens(id,person_id,token_hash,expires_at)
            select gen_random_uuid(),:person,'expired-fixture-'||n,now()-interval '8 days' from generate_series(1,1001)n
            """)
                .param("person", person)
                .update();
        org.springframework.test.util.ReflectionTestUtils.invokeMethod(
                context.getBean("refreshTokenMaintenance"), "clean");
        assertEquals(1L, count("iam.refresh_tokens where token_hash like 'expired-fixture-%'"));
    }

    @Test
    void refreshCleanupKeepsActiveAndRecentlyExpiredCookiesAndEducationalHistory() {
        var person =
                jdbc.sql("select id from iam.persons where role='LECTURER' limit 1")
                        .query(java.util.UUID.class)
                        .single();
        for (int kind = 0; kind < 5; kind++) {
            jdbc.sql(
                            """
                insert into iam.refresh_tokens(id,person_id,token_hash,expires_at,revoked_at)
                values(:id,:person,:hash,
                    now()+case when :kind=1 then interval '-8 days' when :kind=2 then interval '-1 day' else
                    interval '30 days' end,
                    case when :kind=3 then now()-interval '8 days' when :kind=4 then now()-interval '1 day'
                    else null end)
                """)
                    .param("id", java.util.UUID.randomUUID())
                    .param("person", person)
                    .param("hash", "cleanup-fixture-" + kind)
                    .param("kind", kind)
                    .update();
        }
        long visits = count("live.session_participants");
        org.springframework.test.util.ReflectionTestUtils.invokeMethod(
                context.getBean("refreshTokenMaintenance"), "clean");
        var kept =
                jdbc.sql(
                                "select token_hash from iam.refresh_tokens where token_hash like"
                                        + " 'cleanup-fixture-%' order by token_hash")
                        .query(String.class)
                        .list();
        assertEquals(
                java.util.List.of("cleanup-fixture-0", "cleanup-fixture-2", "cleanup-fixture-4"),
                kept);
        assertEquals(visits, count("live.session_participants"));
    }

    @Test
    void requestFromAnAllowedOriginGetsTheCorsHeaderBack() throws Exception {
        mockMvc.perform(get("/api/v1/system/info").header("Origin", ALLOWED_ORIGIN))
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                                .isOk())
                .andExpect(
                        org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
                                .string("Access-Control-Allow-Origin", ALLOWED_ORIGIN));
    }

    @Test
    void requestFromADisallowedOriginIsRejected() throws Exception {
        var result =
                mockMvc.perform(get("/api/v1/system/info").header("Origin", DISALLOWED_ORIGIN))
                        .andReturn();
        assertEquals(403, result.getResponse().getStatus());
        assertNull(result.getResponse().getHeader("Access-Control-Allow-Origin"));
    }

    @Test
    void authMaxIsRateLimitedPerClient() throws Exception {
        for (int i = 0; i < 3; i++) {
            loginWithMax(1000 + i, 200);
        }

        loginWithMax(2000, 429); // тот же клиент (тот же IP в MockMvc), лимит — 3/мин
    }

    @Test
    void signalsAreRateLimitedPerClient() throws Exception {
        String token = join(null, "{\"displayName\":\"Аня\"}").get("participantToken").asText();

        for (int i = 0; i < 3; i++) {
            act(
                    "/api/v1/student/sessions/{code}/signals",
                    null,
                    "{\"participantToken\":\"" + token + "\",\"value\":\"GREEN\"}",
                    200);
        }

        act(
                "/api/v1/student/sessions/{code}/signals",
                null,
                "{\"participantToken\":\"" + token + "\",\"value\":\"GREEN\"}",
                429);
    }

    private void loginWithMax(long userId, int expectedStatus) throws Exception {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("auth_date", String.valueOf(Instant.now().getEpochSecond()));
        params.put("user", MaxInitDataSigner.userJson(userId, "Иван", "Петров"));
        String initData = MaxInitDataSigner.sign("identity-test-bot-token-not-a-secret", params);
        json(
                post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("initData", initData))),
                expectedStatus);
    }
}
