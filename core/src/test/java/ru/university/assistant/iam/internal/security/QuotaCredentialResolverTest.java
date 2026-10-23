package ru.university.assistant.iam.internal.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import ru.university.assistant.iam.api.CredentialQuotaSubjectApi;

class QuotaCredentialResolverTest {
    @Test
    void onlyValidatedSubjectsAreCachedForFifteenSecondsAndInvalidValuesAreNeverRetained() {
        MutableClock clock = new MutableClock();
        AtomicInteger lookups = new AtomicInteger();
        CredentialQuotaSubjectApi provider = new CredentialQuotaSubjectApi() {
            @Override public String headerName() { return "X-Participant-Token"; }
            @Override public boolean supports(String path) { return path.startsWith("/api/v1/student/"); }
            @Override public Optional<String> findSubject(String path, String token) {
                lookups.incrementAndGet();
                return token.equals("valid") ? Optional.of("person:verified") : Optional.empty();
            }
        };
        QuotaCredentialResolver resolver = new QuotaCredentialResolver(List.of(provider), clock,
                new SimpleMeterRegistry(), 120_000, 4);
        assertTrue(resolver.resolve("/unrelated", "X-Participant-Token", "valid", "peer").isEmpty());
        assertEquals(0, lookups.get());
        for (int index = 0; index < 2; index++) {
            assertEquals("person:verified", resolver.resolve("/api/v1/student/sessions/ONE",
                    "X-Participant-Token", "valid", "peer").orElseThrow());
        }
        assertEquals(1, lookups.get());
        assertEquals(1, resolver.size());
        for (int index = 0; index < 10; index++) {
            assertTrue(resolver.resolve("/api/v1/student/sessions/ONE", "X-Participant-Token",
                    "invalid-" + index, "peer").isEmpty());
        }
        assertEquals(1, resolver.size());
        assertEquals(11, lookups.get());
        clock.now += 15_001;
        resolver.resolve("/api/v1/student/sessions/ONE", "X-Participant-Token", "valid", "peer");
        assertEquals(12, lookups.get());
    }

    private static final class MutableClock extends Clock {
        long now;
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return Instant.ofEpochMilli(now); }
        @Override public long millis() { return now; }
    }
}
