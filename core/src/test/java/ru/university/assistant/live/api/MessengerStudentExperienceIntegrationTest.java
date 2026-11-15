package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import ru.university.assistant.iam.internal.MaxInitDataSigner;

@SpringBootTest(properties = {"app.experimental.messenger-login=true",
        "app.telegram.bot-token=messenger-test-token-not-a-secret",
        "app.vk.app-id=900", "app.vk.app-secret=vk-test-secret-not-a-secret"})
class MessengerStudentExperienceIntegrationTest extends LiveFlowTestBase {
    private String signed(long id) {
        return MaxInitDataSigner.sign("messenger-test-token-not-a-secret", Map.of(
                "auth_date", Long.toString(Instant.now().getEpochSecond()),
                "user", MaxInitDataSigner.userJson(id, "Иван", "Петров")));
    }

    private JsonNode messenger(long id, String code, int expected) throws Exception {
        return json(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("channel", "telegram", "initData", signed(id),
                        "linkCode", code))), expected);
    }

    @Test
    void messengerUsesOneProfileAndSeparateRefreshCookieAndExplicitLinkCode() throws Exception {
        var result = mockMvc.perform(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("channel", "telegram", "initData", signed(987)))))
                .andExpect(status().isOk()).andReturn();
        var auth = objectMapper.readTree(result.getResponse().getContentAsString());
        Cookie cookie = result.getResponse().getCookie("la_telegram_refresh");
        assertTrue(cookie != null && cookie.getSecure() && cookie.isHttpOnly());
        assertEquals(auth.path("user").path("id"), messenger(987, "", 200).path("user").path("id"));
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(cookie)).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(cookie).header("X-Auth-Channel", "telegram"))
                .andExpect(status().isOk());
        String code = json(post("/api/v1/identity/link-codes").header("Authorization", "Bearer " + lecturerToken), 201)
                .path("code").asText();
        var linked = messenger(1234, code, 200);
        assertEquals("LECTURER", linked.path("user").path("role").asText());
        assertEquals(linked.path("user").path("id"), messenger(1234, "", 200).path("user").path("id"));
        messenger(5678, code, 400);
    }

    @Test
    void vkIdentityIsSeparateFromTelegramAndBothCanLinkToOneExistingProfile() throws Exception {
        String data = "vk_app_id=900&vk_ts=" + Instant.now().getEpochSecond() + "&vk_user_id=987";
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec("vk-test-secret-not-a-secret".getBytes(
                java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
        String signed = data + "&sign=" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                mac.doFinal(data.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        var telegram = messenger(987, "", 200);
        var result = mockMvc.perform(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("channel", "vk", "initData", signed))))
                .andExpect(status().isOk()).andReturn();
        var vk = objectMapper.readTree(result.getResponse().getContentAsString());
        assertNotEquals(telegram.path("user").path("id"), vk.path("user").path("id"));
        var cookie = result.getResponse().getCookie("la_vk_refresh");
        assertTrue(cookie != null && cookie.getSecure() && cookie.isHttpOnly());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(cookie).header("X-Auth-Channel", "telegram"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(cookie).header("X-Auth-Channel", "vk"))
                .andExpect(status().isOk());
        String code = json(post("/api/v1/identity/link-codes")
                .header("Authorization", "Bearer " + telegram.path("accessToken").asText()), 201).path("code").asText();
        // A VK identity already attached to another profile must not silently switch owners.
        mockMvc.perform(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("channel", "vk", "initData", signed, "linkCode", code))))
                .andExpect(status().isConflict());
        assertEquals(1L, jdbc.sql("select count(*) from iam.identity_link_codes where code=:code and used_at is null")
                .param("code", code).query(Long.class).single());
        String otherData = data.replace("vk_user_id=987", "vk_user_id=988");
        String fresh = otherData + "&sign=" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                mac.doFinal(otherData.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        var linked = json(post("/api/v1/auth/messenger").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("channel", "vk", "initData", fresh, "linkCode", code))),
                200);
        assertEquals(telegram.path("user").path("id"), linked.path("user").path("id"));
    }

}
