package ru.university.assistant.content.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * D-03: подпись ссылки на слайд должна зависеть от окна времени, а не от момента вызова —
 * иначе каждый запрос снапшота (сейчас раз в секунду) даёт новый URL картинки и студент
 * перекачивает один и тот же слайд заново.
 */
class SignedSlideUrlServiceTest {
    private static final Duration TTL = Duration.ofMinutes(10);
    private static final UUID COURSE_ID = UUID.randomUUID();
    private static final UUID DECK_ID = UUID.randomUUID();

    @Test
    void consecutiveRequestsSecondsApartInTheSameWindowGetTheSameToken() {
        // Раньше expiresAt = now + TTL считался заново на каждый вызов — эта проверка падала
        // на старом коде, потому что 10:00:00 и 10:00:07 давали разный expiresAt и разную подпись.
        String first = serviceAt("2026-09-24T10:00:00Z").token(COURSE_ID, DECK_ID);
        String second = serviceAt("2026-09-24T10:00:07Z").token(COURSE_ID, DECK_ID);

        assertEquals(first, second);
    }

    @Test
    void tokenChangesOnlyAfterCrossingAWindowBoundary() {
        SignedSlideUrlService atWindowStart = serviceAt("2026-09-24T10:00:00Z");
        String tokenAtStart = atWindowStart.token(COURSE_ID, DECK_ID);
        String tokenJustBeforeBoundary = serviceAt("2026-09-24T10:09:59Z").token(COURSE_ID, DECK_ID);
        String tokenAfterBoundary = serviceAt("2026-09-24T10:10:00Z").token(COURSE_ID, DECK_ID);

        assertEquals(tokenAtStart, tokenJustBeforeBoundary, "оба запроса — из одного 10-минутного окна");
        assertNotEquals(tokenAtStart, tokenAfterBoundary, "новое окно — новый токен");
    }

    @Test
    void tokenIssuedNowIsAlwaysValidNow() {
        SignedSlideUrlService service = serviceAt("2026-09-24T10:09:59Z");
        String token = service.token(COURSE_ID, DECK_ID);

        assertTrue(service.isValid(token, COURSE_ID, DECK_ID), "токен, выданный сейчас же, обязан приниматься сейчас");
    }

    @Test
    void tokenStopsBeingValidAfterItsWindowExpires() {
        String token = serviceAt("2026-09-24T10:00:00Z").token(COURSE_ID, DECK_ID);

        // expiresAt (10:10:00) сам ещё валиден (isValid — нестрогое "не раньше expiresAt"),
        // невалидным токен становится секундой позже.
        assertTrue(serviceAt("2026-09-24T10:10:00Z").isValid(token, COURSE_ID, DECK_ID));
        assertFalse(serviceAt("2026-09-24T10:10:01Z").isValid(token, COURSE_ID, DECK_ID));
    }

    @Test
    void tokenDoesNotValidateForAnotherDeck() {
        String token = serviceAt("2026-09-24T10:00:00Z").token(COURSE_ID, DECK_ID);

        assertFalse(serviceAt("2026-09-24T10:00:01Z").isValid(token, COURSE_ID, UUID.randomUUID()));
    }

    private SignedSlideUrlService serviceAt(String instant) {
        Clock clock = Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
        ContentProperties properties = new ContentProperties(
                Path.of("."), "http://localhost:8000", 100, "test-slide-url-secret", TTL,
                Duration.ofSeconds(5), Duration.ofMinutes(1), 1, 2, 8);
        return new SignedSlideUrlService(properties, clock);
    }
}
