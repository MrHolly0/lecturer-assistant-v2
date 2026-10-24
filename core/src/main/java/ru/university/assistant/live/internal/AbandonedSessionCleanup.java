package ru.university.assistant.live.internal;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class AbandonedSessionCleanup {
    private static final Logger LOG = LoggerFactory.getLogger(AbandonedSessionCleanup.class);
    private final LiveSessionRepository sessions;
    private final LiveSessionService lifecycle;

    AbandonedSessionCleanup(LiveSessionRepository sessions, LiveSessionService lifecycle) {
        this.sessions = sessions;
        this.lifecycle = lifecycle;
    }

    @Scheduled(fixedDelayString = "${app.live.abandoned-cleanup-delay-ms:60000}",
            initialDelayString = "${app.live.abandoned-cleanup-delay-ms:60000}")
    public void closeAbandonedSessions() {
        for (UUID id : sessions.absentPresenterCandidates()) {
            try {
                lifecycle.endIfPresenterAbsent(id);
            } catch (RuntimeException exception) {
                LOG.warn("Unable to complete abandoned session {}", id, exception);
            }
        }
    }
}
