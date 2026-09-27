package ru.university.assistant.live.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StudentSessionSnapshot;

class StudentSseBroadcasterTest {
    @Test
    void publicProjectorReceivesOnlyChangedStudentVisibleState() {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions);
        StudentSessionSnapshot first = snapshot(1);
        StudentSessionSnapshot second = snapshot(2);
        when(sessions.snapshot("ABC234")).thenReturn(first, first, second);
        CountingEmitter emitter = new CountingEmitter();

        broadcaster.registerPublic("ABC234", emitter);
        broadcaster.broadcast();
        assertEquals(1, emitter.events);
        broadcaster.broadcast();
        assertEquals(2, emitter.events);
    }

    @Test
    void unchangedStateDoesNotResendFullSnapshotToEveryStudent() {
        StudentWebSessionService sessions = mock(StudentWebSessionService.class);
        StudentSseBroadcaster broadcaster = new StudentSseBroadcaster(sessions);
        UUID viewer = UUID.randomUUID();
        StudentSessionSnapshot first = snapshot(1);
        StudentSessionSnapshot second = snapshot(2);
        when(sessions.snapshotForViewer("ABC234", viewer)).thenReturn(first);
        when(sessions.snapshotsForViewers("ABC234", Set.of(viewer)))
                .thenReturn(Map.of(viewer, first), Map.of(viewer, first), Map.of(viewer, second));
        CountingEmitter emitter = new CountingEmitter();

        broadcaster.register("ABC234", viewer, emitter);
        broadcaster.broadcast();
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
        private int events;

        @Override
        public synchronized void send(SseEventBuilder builder) throws IOException {
            events++;
        }
    }
}
