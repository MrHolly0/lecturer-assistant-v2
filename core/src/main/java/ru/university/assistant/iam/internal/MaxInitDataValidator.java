package ru.university.assistant.iam.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Проверка подписи {@code initData} мини-приложения MAX по
 * <a href="https://dev.max.ru/docs/webapps/validation">документации</a>:
 * {@code secret_key = HMAC_SHA256(key="WebAppData", message=токен_бота)},
 * {@code hash = hex(HMAC_SHA256(secret_key, отсортированные "k=v" через \n))}.
 */
@Component
class MaxInitDataValidator {
    private static final Duration CLOCK_SKEW = Duration.ofMinutes(2);
    private static final int MAX_INIT_DATA_LENGTH = 8192;

    private final byte[] secretKey;
    private final Duration maxAge;
    private final Clock clock;
    private final ObjectMapper objectMapper;

    MaxInitDataValidator(
            @Value("${app.max.bot-token:}") String botToken,
            @Value("${app.max.init-data-max-age:PT1H}") Duration maxAge,
            Clock clock,
            ObjectMapper objectMapper) {
        this.secretKey = botToken == null || botToken.isBlank()
                ? null
                : hmac("WebAppData".getBytes(StandardCharsets.UTF_8), botToken.getBytes(StandardCharsets.UTF_8));
        this.maxAge = maxAge;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    boolean isConfigured() {
        return secretKey != null;
    }

    MaxInitData validate(String initData) {
        if (secretKey == null) {
            throw new IllegalStateException("MAX bot token is not configured");
        }
        if (initData == null || initData.isBlank() || initData.length() > MAX_INIT_DATA_LENGTH) {
            throw new InvalidInitDataException("initData is empty or too long");
        }

        List<String[]> pairs = new ArrayList<>();
        String receivedHash = null;
        for (String chunk : initData.split("&")) {
            int eq = chunk.indexOf('=');
            if (eq <= 0) {
                throw new InvalidInitDataException("Malformed initData");
            }
            String key = decode(chunk.substring(0, eq));
            String value = decode(chunk.substring(eq + 1));
            if (key.equals("hash")) {
                if (receivedHash != null) {
                    throw new InvalidInitDataException("Duplicated hash");
                }
                receivedHash = value;
            } else {
                pairs.add(new String[] {key, value});
            }
        }
        if (receivedHash == null) {
            throw new InvalidInitDataException("Missing hash");
        }
        pairs.sort((a, b) -> a[0].compareTo(b[0]));
        for (int i = 1; i < pairs.size(); i++) {
            if (pairs.get(i)[0].equals(pairs.get(i - 1)[0])) {
                throw new InvalidInitDataException("Duplicated parameter");
            }
        }

        StringBuilder launchParams = new StringBuilder();
        Map<String, String> byKey = new java.util.HashMap<>();
        for (String[] pair : pairs) {
            if (launchParams.length() > 0) {
                launchParams.append('\n');
            }
            launchParams.append(pair[0]).append('=').append(pair[1]);
            byKey.put(pair[0], pair[1]);
        }
        byte[] signature = hmac(secretKey, launchParams.toString().getBytes(StandardCharsets.UTF_8));
        String computed = HexFormat.of().formatHex(signature);
        if (!MessageDigest.isEqual(
                computed.getBytes(StandardCharsets.UTF_8),
                receivedHash.toLowerCase().getBytes(StandardCharsets.UTF_8))) {
            throw new InvalidInitDataException("Signature mismatch");
        }

        Instant authDate = parseAuthDate(byKey.get("auth_date"));
        Instant now = clock.instant();
        if (authDate.isBefore(now.minus(maxAge))) {
            throw new InvalidInitDataException("initData expired");
        }
        if (authDate.isAfter(now.plus(CLOCK_SKEW))) {
            throw new InvalidInitDataException("auth_date is in the future");
        }

        return parseUser(byKey.get("user"), byKey.get("start_param"), authDate);
    }

    private Instant parseAuthDate(String value) {
        try {
            return Instant.ofEpochSecond(Long.parseLong(value));
        } catch (RuntimeException exception) {
            throw new InvalidInitDataException("Invalid auth_date");
        }
    }

    private MaxInitData parseUser(String userJson, String startParam, Instant authDate) {
        if (userJson == null) {
            throw new InvalidInitDataException("Missing user");
        }
        try {
            JsonNode user = objectMapper.readTree(userJson);
            if (!user.hasNonNull("id") || !user.get("id").canConvertToLong()) {
                throw new InvalidInitDataException("Missing user id");
            }
            return new MaxInitData(
                    user.get("id").asLong(),
                    text(user, "first_name"),
                    text(user, "last_name"),
                    text(user, "username"),
                    startParam,
                    authDate);
        } catch (java.io.IOException exception) {
            throw new InvalidInitDataException("Invalid user");
        }
    }

    private static String text(JsonNode node, String field) {
        return node.hasNonNull(field) ? node.get(field).asText() : null;
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException exception) {
            throw new InvalidInitDataException("Malformed initData");
        }
    }

    private static byte[] hmac(byte[] key, byte[] message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("HmacSHA256 is unavailable", exception);
        }
    }
}
