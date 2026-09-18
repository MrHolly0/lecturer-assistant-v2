package ru.university.assistant.iam.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MaxInitDataValidatorTest {
    private static final String TOKEN = "test-bot-token-not-a-secret";
    private static final Instant NOW = Instant.parse("2026-09-18T12:00:00Z");

    private final MaxInitDataValidator validator = new MaxInitDataValidator(
            TOKEN, Duration.ofHours(1), Clock.fixed(NOW, ZoneOffset.UTC), new ObjectMapper());

    private Map<String, String> params(Instant authDate) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("auth_date", String.valueOf(authDate.getEpochSecond()));
        params.put("query_id", "q-1");
        params.put("start_param", "ABC123");
        params.put("user", MaxInitDataSigner.userJson(4242, "Иван", "Петров"));
        return params;
    }

    @Test
    void acceptsValidSignatureAndExtractsUser() {
        MaxInitData data = validator.validate(MaxInitDataSigner.sign(TOKEN, params(NOW.minusSeconds(3000))));

        assertEquals(4242L, data.userId());
        assertEquals("Иван", data.firstName());
        assertEquals("Петров", data.lastName());
        assertEquals("ABC123", data.startParam());
    }

    @Test
    void rejectsSignatureMadeWithAnotherToken() {
        String initData = MaxInitDataSigner.sign("another-token", params(NOW));

        assertThrows(InvalidInitDataException.class, () -> validator.validate(initData));
    }

    @Test
    void rejectsTamperedUserId() {
        String signed = MaxInitDataSigner.sign(TOKEN, params(NOW));
        String tampered = signed.replace("%22id%22%3A4242", "%22id%22%3A1");

        assertThrows(InvalidInitDataException.class, () -> validator.validate(tampered));
    }

    @Test
    void rejectsExpiredAuthDate() {
        String initData = MaxInitDataSigner.sign(TOKEN, params(NOW.minus(Duration.ofHours(2))));

        assertThrows(InvalidInitDataException.class, () -> validator.validate(initData));
    }

    @Test
    void rejectsAuthDateFromTheFuture() {
        String initData = MaxInitDataSigner.sign(TOKEN, params(NOW.plus(Duration.ofMinutes(10))));

        assertThrows(InvalidInitDataException.class, () -> validator.validate(initData));
    }

    @Test
    void rejectsMissingOrDuplicatedHash() {
        String signed = MaxInitDataSigner.sign(TOKEN, params(NOW));
        String noHash = signed.substring(0, signed.indexOf("&hash="));

        assertThrows(InvalidInitDataException.class, () -> validator.validate(noHash));
        assertThrows(InvalidInitDataException.class, () -> validator.validate(signed + "&hash=00"));
    }

    @Test
    void rejectsGarbage() {
        assertThrows(InvalidInitDataException.class, () -> validator.validate(""));
        assertThrows(InvalidInitDataException.class, () -> validator.validate("not-init-data"));
    }
}
