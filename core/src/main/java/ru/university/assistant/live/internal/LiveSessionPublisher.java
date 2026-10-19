package ru.university.assistant.live.internal;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.context.ApplicationEventPublisher;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionStateChanged;

@Component
class LiveSessionPublisher {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(LiveSessionPublisher.class);
    private final SimpMessagingTemplate messaging;
    private final ApplicationEventPublisher events;

    LiveSessionPublisher(SimpMessagingTemplate messaging, ApplicationEventPublisher events) {
        this.messaging = messaging;
        this.events = events;
    }

    void publish(String type, LiveSession session) {
        Runnable send = () -> {
            if (type.equals("session.paused") || type.equals("session.resumed")
                    || type.equals("session.ended") || type.equals("session.archived")
                    || type.equals("session.cancelled")) {
                events.publishEvent(new SessionStateChanged(session.id(), session.status()));
            }
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
