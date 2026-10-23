package ru.university.assistant.content.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import org.junit.jupiter.api.Test;

class RetryableImportExceptionTest {
    @Test
    void respectsLongRetryAfterAndHttpDateWithoutShorteningItToPollingPeriod() {
        assertEquals(60, new RetryableImportException("busy", "60").retryAfterSeconds());
        String date = ZonedDateTime.now(java.time.ZoneOffset.UTC).plusSeconds(120)
                .format(DateTimeFormatter.RFC_1123_DATE_TIME);
        int seconds = new RetryableImportException("busy", date).retryAfterSeconds();
        assertTrue(seconds >= 119 && seconds <= 121);
        assertEquals(0, new RetryableImportException("busy", "invalid").retryAfterSeconds());
    }
}
