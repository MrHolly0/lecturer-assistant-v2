package ru.university.assistant.iam.internal.security;

import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Semaphore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import ru.university.assistant.iam.api.CredentialQuotaSubjectApi;
import ru.university.assistant.shared.api.CapacityUnavailableException;

/** Positive-only credential lookup cache, separate from the personal quota key space. */
@Component
class QuotaCredentialResolver {
    private static final long POSITIVE_TTL_MILLIS = 15_000;
    private static final int MAXIMUM_ENTRIES = 10_000;
    private final List<CredentialQuotaSubjectApi> providers;
    private final Clock clock;
    private final SlidingWindowRateLimiter lookups;
    private final Semaphore concurrent;
    private final MeterRegistry meters;
    private final Map<String, Entry> positive = new LinkedHashMap<>(16, 0.75f, true);

    QuotaCredentialResolver(List<CredentialQuotaSubjectApi> providers, Clock clock, MeterRegistry meters,
            @Value("${app.security.admission.credential-lookups-per-minute:120000}") int lookupLimit,
            @Value("${app.security.admission.concurrent-credential-lookups:4}") int concurrentLimit) {
        this.providers = List.copyOf(providers); this.clock = clock; this.meters = meters;
        lookups = new SlidingWindowRateLimiter(lookupLimit, Duration.ofMinutes(1), clock, 2000);
        concurrent = new Semaphore(Math.max(1, concurrentLimit));
        meters.gauge("api.admission.credential_cache_entries", this, value -> value.size());
    }

    Optional<String> resolve(String path, String header, String credential, String socketPeer) {
        if (credential == null || credential.isBlank() || credential.length() > 512) return Optional.empty();
        CredentialQuotaSubjectApi provider = providers.stream()
                .filter(item -> item.headerName().equals(header) && item.supports(path)).findFirst().orElse(null);
        if (provider == null) return Optional.empty();
        String key = header + ":" + digest(credential);
        String cached = cached(key);
        if (cached != null) {
            meters.counter("api.admission.credential_lookup", "result", "hit").increment();
            return Optional.of(cached);
        }
        if (!lookups.tryAcquire(socketPeer)) {
            meters.counter("api.admission.credential_lookup", "result", "rejected").increment();
            throw new CapacityUnavailableException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Credential lookup is busy", lookups.retryAfterSeconds(socketPeer));
        }
        if (!concurrent.tryAcquire()) {
            meters.counter("api.admission.credential_lookup", "result", "rejected").increment();
            throw new CapacityUnavailableException(HttpStatus.SERVICE_UNAVAILABLE, "Credential lookup is busy", 1);
        }
        try {
            Optional<String> subject = provider.findSubject(path, credential);
            meters.counter("api.admission.credential_lookup", "result", subject.isPresent() ? "valid" : "invalid")
                    .increment();
            subject.ifPresent(value -> remember(key, value));
            // Invalid tokens are deliberately not retained, even as negative cache entries.
            return subject;
        } finally { concurrent.release(); }
    }

    private synchronized String cached(String key) {
        Entry entry = positive.get(key);
        if (entry == null) return null;
        if (entry.expiresAt() <= clock.millis()) { positive.remove(key); return null; }
        return entry.subject();
    }
    private synchronized void remember(String key, String subject) {
        positive.put(key, new Entry(subject, clock.millis() + POSITIVE_TTL_MILLIS));
        while (positive.size() > MAXIMUM_ENTRIES) {
            var iterator = positive.entrySet().iterator(); iterator.next(); iterator.remove();
        }
    }
    synchronized int size() { return positive.size(); }
    private String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private record Entry(String subject, long expiresAt) {}
}
