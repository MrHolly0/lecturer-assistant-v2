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
 * ограничены по частоте. Отдельный набор свойств (маленькие лимиты) — своя, не общая с
 * остальными наследниками LiveFlowTestBase порция Spring-контекста.
 */
class SecurityHardeningIntegrationTest extends LiveFlowTestBase {
    private static final String ALLOWED_ORIGIN = "http://localhost:5173";
    private static final String DISALLOWED_ORIGIN = "https://evil.example";

    @DynamicPropertySource
    static void rateLimits(DynamicPropertyRegistry registry) {
        registry.add("app.security.rate-limit.auth-max-per-minute", () -> "3");
        registry.add("app.security.rate-limit.signal-per-minute", () -> "3");
    }

    @Test
    void requestFromAnAllowedOriginGetsTheCorsHeaderBack() throws Exception {
        mockMvc.perform(get("/api/v1/system/info").header("Origin", ALLOWED_ORIGIN))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header()
                        .string("Access-Control-Allow-Origin", ALLOWED_ORIGIN));
    }

    @Test
    void requestFromADisallowedOriginIsRejected() throws Exception {
        var result = mockMvc.perform(get("/api/v1/system/info").header("Origin", DISALLOWED_ORIGIN))
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
            act("/api/v1/student/sessions/{code}/signals", null, "{\"participantToken\":\"" + token
                    + "\",\"value\":\"GREEN\"}", 200);
        }

        act("/api/v1/student/sessions/{code}/signals", null, "{\"participantToken\":\"" + token
                + "\",\"value\":\"GREEN\"}", 429);
    }

    private void loginWithMax(long userId, int expectedStatus) throws Exception {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("auth_date", String.valueOf(Instant.now().getEpochSecond()));
        params.put("user", MaxInitDataSigner.userJson(userId, "Иван", "Петров"));
        String initData = MaxInitDataSigner.sign("identity-test-bot-token-not-a-secret", params);
        json(post("/api/v1/auth/max")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("initData", initData))),
                expectedStatus);
    }
}
