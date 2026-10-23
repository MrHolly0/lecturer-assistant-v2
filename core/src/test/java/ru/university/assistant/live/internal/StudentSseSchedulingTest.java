package ru.university.assistant.live.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StudentSessionSnapshot;

class StudentSseSchedulingTest {
    @Test
    void aHundredLecturesAreAdmittedOnTheFirstTickEvenWhileAllFourWorkersAreBlocked() throws Exception {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        SimpleMeterRegistry meters = new SimpleMeterRegistry();
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 4, meters);
        CountDownLatch started = new CountDownLatch(4);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch completed = new CountDownLatch(100);
        StudentSessionSnapshot snapshot = snapshot();
        when(sessions.snapshot(anyString())).thenAnswer(invocation -> {
            started.countDown();
            assertTrue(release.await(3, TimeUnit.SECONDS));
            completed.countDown();
            return snapshot;
        });
        for (int index = 0; index < 100; index++) {
            broadcaster.registerPublic(code(index), mock(SseEmitter.class));
        }
        try {
            broadcaster.scheduleBroadcast();
            assertTrue(started.await(2, TimeUnit.SECONDS));
            assertEquals(96, meters.get("live.sse.snapshot.queue").gauge().value());
            assertEquals(0, meters.get("live.sse.snapshot_rejections").counter().count());
            release.countDown();
            assertTrue(completed.await(2, TimeUnit.SECONDS),
                    "All lectures admitted on the tick must eventually run without another scheduler tick");
        } finally {
            release.countDown();
            broadcaster.stop();
            meters.close();
        }
    }

    @Test
    void repeatedOverloadedTicksGiveEveryLectureATurnAndRejectedCodesAreNotStuckInFlight() {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        ControlledExecutor executor = new ControlledExecutor();
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions, 1, executor);
        Map<String, Integer> calls = new HashMap<>();
        StudentSessionSnapshot snapshot = snapshot();
        when(sessions.snapshot(anyString())).thenAnswer(invocation -> {
            calls.merge(invocation.getArgument(0), 1, Integer::sum);
            return snapshot;
        });
        for (int index = 0; index < 100; index++) {
            broadcaster.registerPublic(code(index), mock(SseEmitter.class));
        }
        try {
            // The controlled worker frees exactly two slots per round. Another
            // tick while full must leave rejected codes eligible for the next round.
            for (int round = 0; round < 50; round++) {
                broadcaster.scheduleBroadcast();
                assertEquals(2, executor.getQueue().size());
                broadcaster.scheduleBroadcast();
                assertEquals(2, executor.getQueue().size());
                executor.completeBatch();
            }
            assertEquals(100, calls.size(), "A stable map prefix must not starve the same tail on every tick");
            assertTrue(calls.values().stream().allMatch(count -> count == 1));
            // Verify wraparound and completion cleanup, not just first delivery.
            for (int round = 0; round < 50; round++) {
                broadcaster.scheduleBroadcast();
                executor.completeBatch();
            }
            assertTrue(calls.values().stream().allMatch(count -> count == 2));
            assertTrue(executor.rejections > 0, "The regression must actually exercise executor rejection");
        } finally { broadcaster.stop(); }
    }

    private static String code(int index) { return "TEST" + String.format("%03d", index); }

    private static StudentSessionSnapshot snapshot() {
        return new StudentSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), "Course", "Lecture", List.of(),
                SessionStatus.LIVE, "ABC234", 1, 2, null, Map.of(), null, null, null, List.of(), false, false);
    }

    /** Deterministically models workers whose capacity is released only by the test. */
    private static final class ControlledExecutor extends ThreadPoolExecutor {
        int rejections;

        ControlledExecutor() {
            super(1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(2));
        }

        @Override public void execute(Runnable command) {
            if (!getQueue().offer(command)) {
                rejections++;
                throw new RejectedExecutionException("Controlled snapshot executor is full");
            }
        }

        void completeBatch() {
            Runnable command;
            while ((command = getQueue().poll()) != null) command.run();
        }
    }
}
