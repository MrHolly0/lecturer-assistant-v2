package ru.university.assistant.iam.internal.security;

import java.time.Clock;
import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Bounded BCrypt work; no queue of waiting requests can occupy the database pool. */
@Component
public final class PasswordAdmission {
    private final Semaphore workers;
    private final SlidingWindowRateLimiter accounts;

    public PasswordAdmission(
            Clock clock,
            @Value("${app.security.password-concurrency:2}") int concurrency,
            @Value("${app.security.password-account-per-minute:30}") int perMinute) {
        workers = new Semaphore(Math.max(1, Math.min(8, concurrency)));
        accounts = new SlidingWindowRateLimiter(perMinute, Duration.ofMinutes(1), clock);
    }

    public <T> T check(String email, Supplier<T> operation) {
        String key = email == null ? "" : email.strip().toLowerCase(Locale.ROOT);
        if (!accounts.tryAcquire(key) || !workers.tryAcquire()) {
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS, "Sign-in is busy; retry shortly");
        }
        try {
            return operation.get();
        } finally {
            workers.release();
        }
    }
}
