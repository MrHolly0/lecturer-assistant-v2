package ru.university.assistant.live.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import ru.university.assistant.iam.api.AccountAccessRevoked;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StudentSessionSnapshot;
import ru.university.assistant.qa.api.QuestionAnswerVisibility;
import ru.university.assistant.qa.api.StudentQuestionAnswer;

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
    void temporarySnapshotFailureDoesNotDisconnectWholeLecture() throws Exception {
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
        assertTrue(emitter.awaitEvents(1, 2, TimeUnit.SECONDS));
        assertEquals(1, emitter.events);
        assertEquals(false, emitter.completed);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertTrue(emitter.awaitEvents(2, 2, TimeUnit.SECONDS));
        assertEquals(2, emitter.events);
        assertEquals(false, emitter.completed);
    }

    @Test
    void publicProjectorReceivesOnlyChangedStudentVisibleState() throws Exception {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 2);
        StudentSessionSnapshot first = snapshot(1);
        StudentSessionSnapshot second = snapshot(2);
        when(sessions.snapshot("ABC234")).thenReturn(first, first, second);
        CountingEmitter emitter = new CountingEmitter();

        broadcaster.registerPublic("ABC234", emitter);
        broadcaster.broadcast();
        assertTrue(emitter.awaitEvents(1, 2, TimeUnit.SECONDS));
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertTrue(emitter.awaitEvents(2, 2, TimeUnit.SECONDS));
        assertEquals(2, emitter.events);
    }

    @Test
    void unchangedStateDoesNotResendFullSnapshotToEveryStudent() throws Exception {
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
        assertTrue(emitter.awaitEvents(1, 2, TimeUnit.SECONDS));
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertTrue(emitter.awaitEvents(2, 2, TimeUnit.SECONDS));
        assertEquals(2, emitter.events);
    }

    @Test
    void blockedClientWriteDoesNotBlockAnotherStudent() throws Exception {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 2);
        CountDownLatch blockedWrite = new CountDownLatch(1);
        CountDownLatch releaseWrite = new CountDownLatch(1);
        CountDownLatch fastWrite = new CountDownLatch(1);
        when(sessions.snapshot("SLOW02")).thenReturn(snapshot(1));
        when(sessions.snapshot("FAST02")).thenReturn(snapshot(1));
        broadcaster.registerPublic("SLOW02", new CountingEmitter() {
            @Override
            public synchronized void send(SseEventBuilder builder) throws IOException {
                blockedWrite.countDown();
                try {
                    releaseWrite.await(3, TimeUnit.SECONDS);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IOException(exception);
                }
                super.send(builder);
            }
        });
        broadcaster.registerPublic("FAST02", new CountingEmitter() {
            @Override
            public synchronized void send(SseEventBuilder builder) throws IOException {
                super.send(builder);
                fastWrite.countDown();
            }
        });
        try {
            broadcaster.broadcast();
            assertTrue(blockedWrite.await(2, TimeUnit.SECONDS));
            assertTrue(fastWrite.await(2, TimeUnit.SECONDS));
        } finally {
            releaseWrite.countDown();
            broadcaster.stop();
        }
    }

    @Test
    void slowClientIsRemovedWhenItsBoundedAnswerQueueFills() throws Exception {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 1);
        UUID viewer = UUID.randomUUID();
        CountDownLatch blockedWrite = new CountDownLatch(1);
        CountDownLatch releaseWrite = new CountDownLatch(1);
        CountDownLatch closed = new CountDownLatch(1);
        when(sessions.snapshotsForViewers("SLOW03", Set.of(viewer))).thenReturn(Map.of(viewer, snapshot(1)));
        when(sessions.canReceive("SLOW03", viewer)).thenReturn(true);
        CountingEmitter emitter = new CountingEmitter() {
            @Override
            public synchronized void send(SseEventBuilder builder) throws IOException {
                blockedWrite.countDown();
                try {
                    releaseWrite.await(3, TimeUnit.SECONDS);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IOException(exception);
                }
                super.send(builder);
            }

            @Override
            public void completeWithError(Throwable error) {
                completed = true;
                closed.countDown();
            }
        };
        broadcaster.register("SLOW03", viewer, emitter);

        try {
            broadcaster.broadcast();
            assertTrue(blockedWrite.await(2, TimeUnit.SECONDS));
            StudentQuestionAnswer answer = new StudentQuestionAnswer(
                    UUID.randomUUID(), "Question", "Answer", QuestionAnswerVisibility.SESSION, Instant.now());
            for (int index = 0; index < 9; index++) {
                broadcaster.publishAnswer(new StudentQuestionAnswerPublished("SLOW03", UUID.randomUUID(), answer));
            }
            assertTrue(closed.await(2, TimeUnit.SECONDS));
            assertTrue(emitter.completed);
        } finally {
            releaseWrite.countDown();
            broadcaster.stop();
        }
    }

    @Test
    void revocationDoesNotBlockOnSpringEmitterWriteLockOrOtherClients() throws Exception {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 2);
        UUID revokedPerson = UUID.randomUUID();
        UUID activePerson = UUID.randomUUID();
        LockedEmitter lockedEmitter = new LockedEmitter();
        CountDownLatch activeDelivered = new CountDownLatch(1);
        CountingEmitter activeEmitter = new CountingEmitter() {
            @Override
            public synchronized void send(SseEventBuilder builder) throws IOException {
                super.send(builder);
                activeDelivered.countDown();
            }
        };
        broadcaster.register("LOCK04", revokedPerson, lockedEmitter);
        broadcaster.register("FAST04", activePerson, activeEmitter);
        lockedEmitter.holdWriteLock();

        try {
            assertTrue(lockedEmitter.lockHeld.await(2, TimeUnit.SECONDS));
            CompletableFuture<Void> revocation = CompletableFuture.runAsync(
                    () -> broadcaster.closeRevokedAccountStreams(new AccountAccessRevoked(revokedPerson)));
            assertTrue(lockedEmitter.closeEntered.await(2, TimeUnit.SECONDS));
            revocation.get(1, TimeUnit.SECONDS);

            when(sessions.canReceive("FAST04", activePerson)).thenReturn(true);
            StudentQuestionAnswer answer = new StudentQuestionAnswer(
                    UUID.randomUUID(), "Question", "Answer", QuestionAnswerVisibility.SESSION, Instant.now());
            broadcaster.publishAnswer(new StudentQuestionAnswerPublished("FAST04", UUID.randomUUID(), answer));
            assertTrue(activeDelivered.await(2, TimeUnit.SECONDS));
        } finally {
            lockedEmitter.releaseWriteLock.countDown();
            broadcaster.stop();
        }
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
            notifyAll();
        }

        synchronized boolean awaitEvents(int expected, long timeout, TimeUnit unit) throws InterruptedException {
            long deadline = System.nanoTime() + unit.toNanos(timeout);
            while (events < expected) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) return false;
                TimeUnit.NANOSECONDS.timedWait(this, remaining);
            }
            return true;
        }
    }

    private static final class LockedEmitter extends SseEmitter {
        private final CountDownLatch lockHeld = new CountDownLatch(1);
        private final CountDownLatch releaseWriteLock = new CountDownLatch(1);
        private final CountDownLatch closeEntered = new CountDownLatch(1);

        void holdWriteLock() {
            Thread locker = new Thread(() -> {
                writeLock.lock();
                lockHeld.countDown();
                try {
                    releaseWriteLock.await();
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                } finally {
                    writeLock.unlock();
                }
            }, "test-sse-write-lock");
            locker.setDaemon(true);
            locker.start();
        }

        @Override
        public void completeWithError(Throwable error) {
            closeEntered.countDown();
            super.completeWithError(error);
        }
    }
}
