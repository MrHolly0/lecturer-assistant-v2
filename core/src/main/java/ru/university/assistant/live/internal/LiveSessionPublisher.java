package ru.university.assistant.live.internal;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import ru.university.assistant.live.api.LiveSession;

@Component
class LiveSessionPublisher {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(LiveSessionPublisher.class);
    private final SimpMessagingTemplate messaging;

    LiveSessionPublisher(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    void publish(String type, LiveSession session) {
        Runnable send = () -> {
            try {
                messaging.convertAndSend("/topic/session/" + session.id(), new LiveSessionMessage(type, session));
            } catch (RuntimeException exception) {
                // The command is already committed. Clients recover from their next authoritative snapshot.
                LOG.warn("Live notification failed for session {} ({})", session.id(), type, exception);
            }
        };
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { send.run(); }
            });
        } else {
            send.run();
        }
    }

    private record LiveSessionMessage(String type, LiveSession session) {}
}
