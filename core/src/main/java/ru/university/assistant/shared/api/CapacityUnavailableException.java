package ru.university.assistant.shared.api;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** A bounded resource is busy; safe clients should honor the minimum delay before retrying. */
public final class CapacityUnavailableException extends ResponseStatusException {
    private final HttpHeaders headers;
    public CapacityUnavailableException(HttpStatus status, String reason, int retryAfterSeconds) {
        super(status, reason);
        HttpHeaders values = new HttpHeaders();
        values.set(HttpHeaders.RETRY_AFTER, Integer.toString(Math.max(1, retryAfterSeconds)));
        headers = HttpHeaders.readOnlyHttpHeaders(values);
    }
    @Override public HttpHeaders getHeaders() { return headers; }
}
