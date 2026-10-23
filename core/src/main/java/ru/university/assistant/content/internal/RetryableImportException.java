package ru.university.assistant.content.internal;

import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

class RetryableImportException extends RuntimeException {
    private final int retryAfterSeconds;

    RetryableImportException(String message, Throwable cause) {
        super(message, cause);
        this.retryAfterSeconds = 0;
    }

    RetryableImportException(String message, String retryAfter) {
        super(message);
        this.retryAfterSeconds = parseRetryAfter(retryAfter);
    }

    int retryAfterSeconds() {
        return retryAfterSeconds;
    }

    private static int parseRetryAfter(String value) {
        if (value == null) return 0;
        try {
            return Math.max(0, Math.toIntExact(Long.parseLong(value.trim())));
        } catch (RuntimeException ignored) {
            try {
                Instant when = ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant();
                return Math.max(0, Math.toIntExact(Duration.between(Instant.now(), when).toSeconds() + 1));
            } catch (RuntimeException invalid) {
                return 0;
            }
        }
    }
}
