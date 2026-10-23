package ru.university.assistant.iam.internal.security;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class SlidingWindowRateLimiterTest {

    @Test
    void allowsUpToTheLimitThenRejects() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-24T10:00:00Z"));
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(3, Duration.ofMinutes(1), clock);

        assertTrue(limiter.tryAcquire("1.2.3.4"));
        assertTrue(limiter.tryAcquire("1.2.3.4"));
        assertTrue(limiter.tryAcquire("1.2.3.4"));
        assertFalse(limiter.tryAcquire("1.2.3.4"));
    }

    @Test
    void differentKeysHaveIndependentBudgets() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-24T10:00:00Z"));
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(1, Duration.ofMinutes(1), clock);

        assertTrue(limiter.tryAcquire("student-a"));
        assertFalse(limiter.tryAcquire("student-a"));
        assertTrue(limiter.tryAcquire("student-b")); // чужой ключ не задет
    }

    @Test
    void oldHitsExpireOutOfTheWindow() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-24T10:00:00Z"));
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(1, Duration.ofMinutes(1), clock);

        assertTrue(limiter.tryAcquire("1.2.3.4"));
        assertFalse(limiter.tryAcquire("1.2.3.4"));

        clock.advance(Duration.ofMinutes(1).plusSeconds(1));

        assertTrue(limiter.tryAcquire("1.2.3.4")); // старое обращение уже вне окна
    }

    @Test
    void keyChurnCannotResetLiveBudgetsAndIdleEntriesExpire() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-24T10:00:00Z"));
        SlidingWindowRateLimiter limiter = new SlidingWindowRateLimiter(1, Duration.ofSeconds(10), clock, 2);
        assertTrue(limiter.tryAcquire("one"));
        assertTrue(limiter.tryAcquire("two"));
        assertFalse(limiter.tryAcquire("three"));
        assertFalse(limiter.tryAcquire("one"));
        assertEquals(2, limiter.keyCount());
        clock.advance(Duration.ofSeconds(21));
        assertTrue(limiter.tryAcquire("three"));
        assertEquals(1, limiter.keyCount());
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        MutableClock(Instant instant) {
            this.instant = instant;
        }

        void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
