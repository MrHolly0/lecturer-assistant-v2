package ru.university.assistant.iam.internal.security;

import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

/** Constant-space token buckets, with bounded keys and idle expiry. No per-request timestamp log. */
class SlidingWindowRateLimiter {
    private final int limit;
    private final long windowMillis;
    private final int maximumKeys;
    private final Clock clock;
    private final Map<String, Bucket> buckets = new HashMap<>();
    private long nextCleanup;

    SlidingWindowRateLimiter(int limit, Duration window, Clock clock) {
        this(limit, window, clock, 20_000);
    }

    SlidingWindowRateLimiter(int limit, Duration window, Clock clock, int maximumKeys) {
        if (limit < 1 || window.isZero() || window.isNegative() || maximumKeys < 1) {
            throw new IllegalArgumentException("Positive rate limit, window and key budget are required");
        }
        this.limit = limit;
        this.windowMillis = Math.max(1, window.toMillis());
        this.clock = clock;
        this.maximumKeys = maximumKeys;
    }

    synchronized boolean tryAcquire(String key) {
        long now = clock.millis();
        if (now >= nextCleanup) {
            buckets.values().removeIf(bucket -> now - bucket.lastSeen >= windowMillis * 2);
            nextCleanup = now + Math.min(windowMillis, 1000);
        }
        Bucket bucket = buckets.get(key);
        if (bucket == null) {
            // Evicting a live key would reset its allowance and let key churn bypass the limit.
            if (buckets.size() >= maximumKeys) return false;
            bucket = new Bucket(limit, now);
            buckets.put(key, bucket);
        }
        bucket.tokens = Math.min(limit,
                bucket.tokens + Math.max(0, now - bucket.refilledAt) * (double) limit / windowMillis);
        bucket.refilledAt = Math.max(now, bucket.refilledAt);
        bucket.lastSeen = Math.max(now, bucket.lastSeen);
        if (bucket.tokens < 1) return false;
        bucket.tokens--;
        return true;
    }

    synchronized int retryAfterSeconds(String key) {
        long now = clock.millis();
        Bucket bucket = buckets.get(key);
        if (bucket == null) {
            long earliest = buckets.values().stream().mapToLong(value -> value.lastSeen + windowMillis * 2)
                    .min().orElse(now + 1000);
            return (int) Math.max(1, Math.ceil(Math.max(0, earliest - now) / 1000.0));
        }
        double available = Math.min(limit,
                bucket.tokens + Math.max(0, now - bucket.refilledAt) * (double) limit / windowMillis);
        return (int) Math.max(1, Math.ceil(Math.max(0, 1 - available) * windowMillis / limit / 1000));
    }

    synchronized int keyCount() { return buckets.size(); }

    private static final class Bucket {
        double tokens;
        long refilledAt;
        long lastSeen;
        Bucket(double tokens, long now) {
            this.tokens = tokens; this.refilledAt = now; this.lastSeen = now;
        }
    }
}
