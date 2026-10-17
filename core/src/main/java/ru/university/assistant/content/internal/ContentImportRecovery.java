package ru.university.assistant.content.internal;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** Turns jobs left by a process restart into visible, retryable terminal outcomes. */
@Component
public class ContentImportRecovery {
    private static final Logger LOG = LoggerFactory.getLogger(ContentImportRecovery.class);
    private final ContentRepository repository;

    ContentImportRecovery(ContentRepository repository) {
        this.repository = repository;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void recoverInterruptedJobs() {
        int recovered = repository.failInterruptedJobs();
        if (recovered > 0) {
            LOG.warn("Marked {} interrupted slide import job(s) retryable after restart", recovered);
        }
    }
}
