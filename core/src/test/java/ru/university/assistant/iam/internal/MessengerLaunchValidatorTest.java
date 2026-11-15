package ru.university.assistant.iam.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class MessengerLaunchValidatorTest {
    private static final String TOKEN = "messenger-test-token-not-a-secret";
    private static final String VK_SECRET = "vk-test-secret-not-a-secret";
    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    private final MessengerLaunchValidator validator = new MessengerLaunchValidator(
            TOKEN, "900", VK_SECRET, Duration.ofHours(1), Clock.fixed(NOW, ZoneOffset.UTC), new ObjectMapper());

    private Map<String, String> telegram(Instant time) {
        return Map.of("auth_date", String.valueOf(time.getEpochSecond()),
                "user", MaxInitDataSigner.userJson(987L, "Иван", "Петров"), "start_param", "ABC123");
    }

    @Test
    void verifiesTelegramIdentityAndRejectsTampering() {
        String data = MaxInitDataSigner.sign(TOKEN, telegram(NOW));
        var launch = validator.validate("telegram", data);
        assertEquals("987", launch.externalId());
        assertEquals("Иван Петров", launch.displayName());
        assertEquals("ABC123", launch.startParam());
        for (String broken : new String[] {data + "&user=x", data + "&%68ash=x",
                data.replace("ABC123", "HACKED"), data.replace("auth_date=", "auth_date=9"), "user=x", "x=%ZZ"}) {
            assertUnauthorized("telegram", broken);
        }
        assertUnauthorized("telegram", MaxInitDataSigner.sign("wrong", telegram(NOW)));
        assertUnauthorized("telegram", MaxInitDataSigner.sign(TOKEN, telegram(NOW.minusSeconds(3601))));
        assertUnauthorized("telegram", MaxInitDataSigner.sign(TOKEN, telegram(NOW.plusSeconds(121))));
    }

    @Test
    void signedTelegramDataStillRequiresIntegralPositiveUserAndTime() {
        for (String user : new String[] {"{}", "null", "{\"id\":-1}", "{\"id\":1.5}", "{\"id\":\"987\"}"}) {
            assertUnauthorized("telegram", MaxInitDataSigner.sign(TOKEN,
                    Map.of("auth_date", Long.toString(NOW.getEpochSecond()), "user", user)));
        }
        assertUnauthorized("telegram", MaxInitDataSigner.sign(TOKEN, Map.of("user", "{\"id\":987}")));
    }

    @Test
    void verifiesVkSignatureTimestampAppAndUserInsteadOfUnsignedProfile() throws Exception {
        Map<String, String> fields = Map.of("vk_app_id", "900", "vk_user_id", "987",
                "vk_ts", Long.toString(NOW.getEpochSecond()), "vk_language", "ru");
        String signed = vkSign(fields);
        assertEquals("987", validator.validate("vk", signed + "&user_id=1").externalId());
        assertUnauthorized("vk", signed.replace("vk_user_id=987", "vk_user_id=1"));
        assertUnauthorized("vk", signed + "&vk_app_id=900");
        for (Map<String, String> bad : java.util.List.of(
                Map.of("vk_app_id", "901", "vk_user_id", "987", "vk_ts", fields.get("vk_ts")),
                Map.of("vk_app_id", "900", "vk_user_id", "0", "vk_ts", fields.get("vk_ts")),
                Map.of("vk_app_id", "900", "vk_user_id", "987", "vk_ts", "0"))) {
            assertUnauthorized("vk", vkSign(bad));
        }
        assertUnauthorized("telegram", signed);
        assertUnauthorized("vk", MaxInitDataSigner.sign(TOKEN, telegram(NOW)));
    }

    private void assertUnauthorized(String channel, String data) {
        var error = assertThrows(ResponseStatusException.class, () -> validator.validate(channel, data));
        assertEquals(401, error.getStatusCode().value());
    }

    private static String vkSign(Map<String, String> fields) throws Exception {
        String data = new TreeMap<>(fields).entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "="
                        + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8)).collect(Collectors.joining("&"));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(VK_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return data + "&sign=" + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
    }
}
