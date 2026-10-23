package ru.university.assistant.live.internal;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.Message;
import org.springframework.util.MimeTypeUtils;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionSynchronizationUtils;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.SessionStateChanged;

class LiveSessionPublisherTransactionTest {
    private final SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final LiveSessionPublisher publisher = new LiveSessionPublisher(messaging, events, json);

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
        ArgumentCaptor<Message<?>> payload = ArgumentCaptor.forClass(Message.class);
        verify(messaging).send(destination.capture(), payload.capture());
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

    @Test
    void smallSnapshotRetainsWireShapeAndLargeSnapshotQueuesOnlyCompactInvalidation() throws Exception {
        LiveSession small = session();
        publisher.publish("session.updated", small);
        ArgumentCaptor<Message<?>> payload = ArgumentCaptor.forClass(Message.class);
        verify(messaging).send(org.mockito.ArgumentMatchers.eq("/topic/session/" + small.id()), payload.capture());
        assertEquals(MimeTypeUtils.APPLICATION_JSON, payload.getValue().getHeaders().get("contentType"));
        JsonNode full = json.readTree((byte[]) payload.getValue().getPayload());
        assertEquals("session.updated", full.path("type").asText());
        assertEquals(small.id().toString(), full.path("session").path("id").asText());

        reset(messaging);
        // A single large string exercises the streaming cap, without first
        // allocating a serialized copy of the entire multi-megabyte snapshot.
        LiveSession large = new LiveSession(small.id(), small.courseId(), small.lectureId(), small.deckId(),
                small.lectureTitle(), small.groups(), small.status(), small.joinCode(), 1,
                Map.of("1", "x".repeat(4 * 1024 * 1024)), null, null, null, 0, 0, 17, false);
        publisher.publish("qa.updated", large);
        verify(messaging).send(org.mockito.ArgumentMatchers.eq("/topic/session/" + large.id()), payload.capture());
        byte[] bytes = (byte[]) payload.getValue().getPayload();
        assertTrue(bytes.length < 1024);
        JsonNode invalidation = json.readTree(bytes);
        assertEquals("session.invalidate", invalidation.path("type").asText());
        assertEquals("qa.updated", invalidation.path("eventType").asText());
        assertEquals(large.id().toString(), invalidation.path("sessionId").asText());
        assertEquals(17, invalidation.path("version").asLong());
        assertFalse(invalidation.has("session"));
        assertFalse(invalidation.has("annotations"));
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
