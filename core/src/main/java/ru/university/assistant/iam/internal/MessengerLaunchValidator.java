package ru.university.assistant.iam.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Identity comes from authenticated launch data, never a client-supplied profile. */
@Component
class MessengerLaunchValidator {
    private final String telegramToken;
    private final String vkAppId;
    private final String vkSecret;
    private final Clock clock;
    private final ObjectMapper json;
    private final Duration maxAge;

    MessengerLaunchValidator(@Value("${app.telegram.bot-token:}") String telegramToken,
            @Value("${app.vk.app-id:}") String vkAppId,
            @Value("${app.vk.app-secret:}") String vkSecret,
            @Value("${app.experimental.launch-max-age:PT1H}") Duration maxAge,
            Clock clock, ObjectMapper json) {
        this.telegramToken = telegramToken;
        this.vkAppId = vkAppId;
        this.vkSecret = vkSecret;
        if (maxAge.isNegative() || maxAge.isZero() || maxAge.compareTo(Duration.ofDays(1)) > 0) {
            throw new IllegalArgumentException("Launch data age must be between zero and one day");
        }
        this.maxAge = maxAge;
        this.clock = clock;
        this.json = json;
    }

    VerifiedLaunch validate(String channel, String launchData) {
        if (!channel.equals("telegram") && !channel.equals("vk")) throw invalid();
        if ((channel.equals("telegram") && telegramToken.isBlank())
                || (channel.equals("vk") && (vkAppId.isBlank() || vkSecret.isBlank()))) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Messenger is not configured");
        }
        try {
            Map<String, String> fields = parse(launchData);
            return channel.equals("telegram") ? telegram(fields) : vk(fields);
        } catch (IllegalArgumentException | java.time.DateTimeException | java.io.IOException exception) {
            throw invalid();
        }
    }

    private VerifiedLaunch telegram(Map<String, String> fields) throws java.io.IOException {
        String signature = fields.remove("hash");
        String check = fields.entrySet().stream().map(e -> e.getKey() + "=" + e.getValue())
                .collect(Collectors.joining("\n"));
        byte[] secret = hmac("WebAppData".getBytes(StandardCharsets.UTF_8), telegramToken);
        verify(signature, HexFormat.of().formatHex(hmac(secret, check)));
        checkDate(fields.get("auth_date"));
        JsonNode user = json.readTree(fields.getOrDefault("user", "{}"));
        if (user == null || !user.path("id").isIntegralNumber()
                || !user.path("id").canConvertToLong() || user.path("id").asLong() <= 0) {
            throw invalid();
        }
        String name = (user.path("first_name").asText("") + " " + user.path("last_name").asText("")).trim();
        return new VerifiedLaunch("telegram", user.path("id").asText(),
                name.isBlank() ? "Студент Telegram" : name.substring(0, Math.min(name.length(), 160)),
                fields.get("start_param"));
    }

    private VerifiedLaunch vk(Map<String, String> fields) {
        String check = fields.entrySet().stream().filter(e -> e.getKey().startsWith("vk_"))
                .map(e -> encode(e.getKey()) + "=" + encode(e.getValue())).collect(Collectors.joining("&"));
        verify(fields.get("sign"), Base64.getUrlEncoder().withoutPadding()
                .encodeToString(hmac(vkSecret.getBytes(StandardCharsets.UTF_8), check)));
        if (!vkAppId.equals(fields.get("vk_app_id"))) throw invalid();
        checkDate(fields.get("vk_ts"));
        long userId = Long.parseLong(fields.getOrDefault("vk_user_id", "0"));
        if (userId <= 0) throw invalid();
        return new VerifiedLaunch("vk", Long.toString(userId), "Студент VK", null);
    }

    private void checkDate(String raw) {
        Instant issued = Instant.ofEpochSecond(Long.parseLong(raw));
        if (issued.isBefore(clock.instant().minus(maxAge))
                || issued.isAfter(clock.instant().plusSeconds(120))) throw invalid();
    }

    private static Map<String, String> parse(String raw) {
        if (raw == null || raw.isBlank() || raw.length() > 8192) throw invalid();
        Map<String, String> fields = new TreeMap<>();
        for (String part : raw.split("&", -1)) {
            int split = part.indexOf('=');
            if (split <= 0) throw invalid();
            String key = URLDecoder.decode(part.substring(0, split), StandardCharsets.UTF_8);
            String value = URLDecoder.decode(part.substring(split + 1), StandardCharsets.UTF_8);
            if (fields.putIfAbsent(key, value) != null) throw invalid();
        }
        return fields;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static byte[] hmac(byte[] key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("HMAC is unavailable", exception);
        }
    }

    private static void verify(String received, String expected) {
        if (received == null || !MessageDigest.isEqual(received.getBytes(StandardCharsets.US_ASCII),
                expected.getBytes(StandardCharsets.US_ASCII))) throw invalid();
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid messenger launch data");
    }

    record VerifiedLaunch(String channel, String externalId, String displayName, String startParam) {}
}
