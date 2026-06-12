package ru.university.assistant.content.internal;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

@Service
class SignedSlideUrlService {
    private static final String HMAC_ALGORITHM = "HmacSHA256";

    private final ContentProperties properties;
    private final Clock clock;

    SignedSlideUrlService(ContentProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
    }

    String token(UUID courseId, UUID deckId) {
        long expiresAt = Instant.now(clock).plus(properties.slideImageUrlTtl()).getEpochSecond();
        return expiresAt + "." + signature(courseId, deckId, expiresAt);
    }

    boolean isValid(String token, UUID courseId, UUID deckId) {
        if (token == null || token.isBlank()) {
            return false;
        }
        int dot = token.indexOf('.');
        if (dot <= 0 || dot == token.length() - 1) {
            return false;
        }
        try {
            long expiresAt = Long.parseLong(token.substring(0, dot));
            if (expiresAt < Instant.now(clock).getEpochSecond()) {
                return false;
            }
            String expected = signature(courseId, deckId, expiresAt);
            return constantTimeEquals(expected, token.substring(dot + 1));
        } catch (NumberFormatException exception) {
            return false;
        }
    }

    String slideImageUrl(UUID courseId, UUID deckId, int slideIndex, String token) {
        return "/api/v1/courses/" + courseId + "/decks/" + deckId + "/slides/" + slideIndex + "/image?t=" + token;
    }

    private String signature(UUID courseId, UUID deckId, long expiresAt) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            byte[] secret = properties.slideImageUrlSecret().getBytes(StandardCharsets.UTF_8);
            mac.init(new SecretKeySpec(secret, HMAC_ALGORITHM));
            byte[] digest = mac.doFinal((courseId + ":" + deckId + ":" + expiresAt).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception exception) {
            throw new IllegalStateException("Cannot sign slide URL", exception);
        }
    }

    private boolean constantTimeEquals(String left, String right) {
        byte[] a = left.getBytes(StandardCharsets.UTF_8);
        byte[] b = right.getBytes(StandardCharsets.UTF_8);
        if (a.length != b.length) {
            return false;
        }
        int result = 0;
        for (int index = 0; index < a.length; index++) {
            result |= a[index] ^ b[index];
        }
        return result == 0;
    }
}
