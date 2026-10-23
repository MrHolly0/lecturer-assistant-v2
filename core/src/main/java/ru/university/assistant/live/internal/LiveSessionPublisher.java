package ru.university.assistant.live.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.stereotype.Component;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.util.MimeTypeUtils;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionStateChanged;

@Component
class LiveSessionPublisher {
    private static final int MAX_SNAPSHOT_BYTES = 256 * 1024;
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(LiveSessionPublisher.class);
    private final SimpMessagingTemplate messaging;
    private final ApplicationEventPublisher events;
    private final ObjectMapper json;

    LiveSessionPublisher(SimpMessagingTemplate messaging, ApplicationEventPublisher events, ObjectMapper json) {
        this.messaging = messaging;
        this.events = events;
        this.json = json;
    }

    void participantAccessRevoked(LiveSession session, UUID personId) {
        Runnable notify = () -> events.publishEvent(new ParticipantAccessRevoked(session.joinCode(), personId));
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { notify.run(); }
            });
        } else notify.run();
    }

    void publish(String type, LiveSession session) {
        Runnable send = () -> {
            if (type.equals("session.paused") || type.equals("session.resumed")
                    || type.equals("session.ended") || type.equals("session.archived")
                    || type.equals("session.cancelled")) {
                events.publishEvent(new SessionStateChanged(session.id(), session.status()));
            }
            try {
                // Queue only bounded serialized bytes. Large annotations remain
                // in HTTP storage, never as a large session object per subscriber.
                byte[] payload = notification(type, session);
                SimpMessageHeaderAccessor headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
                headers.setContentType(MimeTypeUtils.APPLICATION_JSON);
                messaging.send("/topic/session/" + session.id(),
                        MessageBuilder.createMessage(payload, headers.getMessageHeaders()));
            } catch (IOException | RuntimeException exception) {
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

    private byte[] notification(String type, LiveSession session) throws IOException {
        LimitedOutputStream output = new LimitedOutputStream(MAX_SNAPSHOT_BYTES);
        try {
            json.writeValue(output, new LiveSessionMessage(type, session));
            return output.toByteArray();
        } catch (IOException exception) {
            Throwable cause = exception;
            while (cause != null && !(cause instanceof SnapshotTooLargeException)) cause = cause.getCause();
            if (cause == null) throw exception;
            return json.writeValueAsBytes(new LiveSessionInvalidation(
                    "session.invalidate", session.id(), session.version(), type));
        }
    }

    private record LiveSessionMessage(String type, LiveSession session) {}
    private record LiveSessionInvalidation(String type, UUID sessionId, long version, String eventType) {}

    private static final class SnapshotTooLargeException extends IOException {}

    private static final class LimitedOutputStream extends OutputStream {
        private final int limit;
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();

        LimitedOutputStream(int limit) { this.limit = limit; }

        @Override public void write(int value) throws IOException {
            if (bytes.size() >= limit) throw new SnapshotTooLargeException();
            bytes.write(value);
        }

        @Override public void write(byte[] values, int offset, int length) throws IOException {
            if (length > limit - bytes.size()) throw new SnapshotTooLargeException();
            bytes.write(values, offset, length);
        }

        byte[] toByteArray() { return bytes.toByteArray(); }
    }
}
