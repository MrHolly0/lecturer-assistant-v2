package ru.university.assistant.live.internal;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import static org.junit.jupiter.api.Assertions.assertEquals;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionSynchronizationUtils;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.SessionStateChanged;

class LiveSessionPublisherTransactionTest {
    private final SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final LiveSessionPublisher publisher = new LiveSessionPublisher(messaging, events);

    @Test
    void publishesAfterCommitButNotAfterRollback() {
        LiveSession session = session();
        beginTransaction();
        try {
            publisher.publish("session.updated", session);
            verifyNoInteractions(messaging);
            TransactionSynchronizationUtils.triggerBeforeCommit(false);
            TransactionSynchronizationUtils.triggerBeforeCompletion();
            TransactionSynchronizationUtils.triggerAfterCommit();
            TransactionSynchronizationUtils.triggerAfterCompletion(
                    org.springframework.transaction.support.TransactionSynchronization.STATUS_COMMITTED);
        } finally {
            clearTransaction();
        }
        ArgumentCaptor<String> destination = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(messaging).convertAndSend(destination.capture(), payload.capture());
        assertEquals("/topic/session/" + session.id(), destination.getValue());

        reset(messaging);
        beginTransaction();
        try {
            publisher.publish("session.updated", session);
            verifyNoInteractions(messaging);
            TransactionSynchronizationUtils.triggerAfterCompletion(
                    org.springframework.transaction.support.TransactionSynchronization.STATUS_ROLLED_BACK);
        } finally {
            clearTransaction();
        }
        verifyNoInteractions(messaging);
    }

    @Test
    void mediaInvalidationSeesOnlyCommittedStateTransitions() {
        LiveSession paused = session(SessionStatus.PAUSED);
        beginTransaction();
        try {
            publisher.publish("session.paused", paused);
            verifyNoInteractions(events);
            TransactionSynchronizationUtils.triggerAfterCommit();
        } finally { clearTransaction(); }
        verify(events).publishEvent(new SessionStateChanged(paused.id(), SessionStatus.PAUSED));
        reset(events);
        beginTransaction();
        try {
            publisher.publish("session.paused", paused);
            TransactionSynchronizationUtils.triggerAfterCompletion(
                    org.springframework.transaction.support.TransactionSynchronization.STATUS_ROLLED_BACK);
        } finally { clearTransaction(); }
        verifyNoInteractions(events);
    }

    private void beginTransaction() {
        TransactionSynchronizationManager.setActualTransactionActive(true);
        TransactionSynchronizationManager.initSynchronization();
    }

    private void clearTransaction() {
        TransactionSynchronizationManager.clearSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(false);
    }

    private LiveSession session() {
        return session(SessionStatus.LIVE);
    }

    private LiveSession session(SessionStatus status) {
        return new LiveSession(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "Lecture", List.of(),
                status, "ABC234", 1, Map.of(), null, null, null, 0, 0);
    }
}
