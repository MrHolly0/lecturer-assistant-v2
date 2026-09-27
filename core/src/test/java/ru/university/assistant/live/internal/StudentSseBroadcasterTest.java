package ru.university.assistant.live.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StudentSessionSnapshot;

class StudentSseBroadcasterTest {
    @Test
    void slowLectureDoesNotHoldUpAnotherLecture() throws Exception {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 2);
        CountDownLatch slowStarted = new CountDownLatch(1);
        CountDownLatch releaseSlow = new CountDownLatch(1);
        CountDownLatch slowFinished = new CountDownLatch(1);
        CountDownLatch fastDelivered = new CountDownLatch(1);
        when(sessions.snapshot("SLOW01")).thenAnswer(invocation -> {
            slowStarted.countDown();
            releaseSlow.await(3, TimeUnit.SECONDS);
            slowFinished.countDown();
            return snapshot(2);
        });
        when(sessions.snapshot("FAST01")).thenReturn(snapshot(1));
        broadcaster.registerPublic("SLOW01", new CountingEmitter());
        broadcaster.registerPublic("FAST01", new CountingEmitter() {
            @Override
            public synchronized void send(SseEventBuilder builder) throws IOException {
                super.send(builder);
                if (events == 1) fastDelivered.countDown();
            }
        });

        try {
            broadcaster.scheduleBroadcast();
            assertTrue(slowStarted.await(2, TimeUnit.SECONDS));
            assertTrue(fastDelivered.await(2, TimeUnit.SECONDS));
        } finally {
            releaseSlow.countDown();
            assertTrue(slowFinished.await(2, TimeUnit.SECONDS));
            broadcaster.stop();
        }
    }

    @Test
    void temporarySnapshotFailureDoesNotDisconnectWholeLecture() {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 2);
        StudentSessionSnapshot first = snapshot(1);
        StudentSessionSnapshot second = snapshot(2);
        when(sessions.snapshot("ABC234"))
                .thenReturn(first)
                .thenThrow(new IllegalStateException("temporary database contention"))
                .thenReturn(second);
        CountingEmitter emitter = new CountingEmitter();

        broadcaster.registerPublic("ABC234", emitter);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        assertEquals(false, emitter.completed);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertEquals(2, emitter.events);
        assertEquals(false, emitter.completed);
    }

    @Test
    void publicProjectorReceivesOnlyChangedStudentVisibleState() {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 2);
        StudentSessionSnapshot first = snapshot(1);
        StudentSessionSnapshot second = snapshot(2);
        when(sessions.snapshot("ABC234")).thenReturn(first, first, second);
        CountingEmitter emitter = new CountingEmitter();

        broadcaster.registerPublic("ABC234", emitter);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertEquals(2, emitter.events);
    }

    @Test
    void unchangedStateDoesNotResendFullSnapshotToEveryStudent() {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 2);
        UUID viewer = UUID.randomUUID();
        StudentSessionSnapshot first = snapshot(1);
        StudentSessionSnapshot second = snapshot(2);
        when(sessions.snapshotsForViewers("ABC234", Set.of(viewer)))
                .thenReturn(Map.of(viewer, first), Map.of(viewer, first), Map.of(viewer, second));
        CountingEmitter emitter = new CountingEmitter();

        broadcaster.register("ABC234", viewer, emitter);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertEquals(2, emitter.events);
    }

    private StudentSessionSnapshot snapshot(int slideIdx) {
        return new StudentSessionSnapshot(
                UUID.randomUUID(), UUID.randomUUID(), "Курс", "Лекция", List.of(), SessionStatus.LIVE,
                "ABC234", slideIdx, 2, null, Map.of(), null, null, null, List.of(), false, false);
    }

    private static class CountingEmitter extends SseEmitter {
        protected int events;
        protected boolean completed;

        @Override
        public void complete() {
            completed = true;
        }

        @Override
        public synchronized void send(SseEventBuilder builder) throws IOException {
            events++;
        }
    }
}
