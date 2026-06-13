package ru.university.assistant.live.internal;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StudentSessionSnapshot;

/**
 * Раздаёт снапшот сессии всем подключённым студентам одним планировщиком, а не
 * потоком-на-студента. Снапшот считается один раз на сессию за тик, поэтому 150
 * SSE-клиентов одной лекции — это один запрос в БД в секунду, а не 150, и горстка
 * потоков планировщика вместо 150 заблокированных.
 */
@Component
public class StudentSseBroadcaster {
    private final Map<String, Set<SseEmitter>> emittersByCode = new ConcurrentHashMap<>();
    private final StudentWebSessionService sessions;

    StudentSseBroadcaster(StudentWebSessionService sessions) {
        this.sessions = sessions;
    }

    public void register(String joinCode, SseEmitter emitter) {
        String code = joinCode.trim().toUpperCase();
        Set<SseEmitter> set = emittersByCode.computeIfAbsent(code, key -> ConcurrentHashMap.newKeySet());
        set.add(emitter);
        emitter.onCompletion(() -> remove(code, emitter));
        emitter.onTimeout(() -> {
            emitter.complete();
            remove(code, emitter);
        });
        emitter.onError(error -> remove(code, emitter));
        // Сразу отдаём текущее состояние, чтобы клиент не ждал до секунды.
        StudentSessionSnapshot initial = safeSnapshot(code);
        if (initial != null) {
            send(code, emitter, initial);
        }
    }

    @Scheduled(fixedRate = 1000)
    void broadcast() {
        for (Map.Entry<String, Set<SseEmitter>> entry : emittersByCode.entrySet()) {
            String code = entry.getKey();
            Set<SseEmitter> set = entry.getValue();
            if (set.isEmpty()) {
                emittersByCode.remove(code, set);
                continue;
            }
            StudentSessionSnapshot snapshot;
            try {
                snapshot = sessions.snapshot(code);
            } catch (RuntimeException exception) {
                // Сессия исчезла/недоступна — закрываем всех подключённых к этому коду.
                set.forEach(SseEmitter::complete);
                emittersByCode.remove(code);
                continue;
            }
            boolean ended =
                    snapshot.status() == SessionStatus.ENDED || snapshot.status() == SessionStatus.ARCHIVED;
            for (SseEmitter emitter : set) {
                boolean delivered = send(code, emitter, snapshot);
                if (ended && delivered) {
                    emitter.complete();
                }
            }
            if (ended) {
                emittersByCode.remove(code);
            }
        }
    }

    private StudentSessionSnapshot safeSnapshot(String code) {
        try {
            return sessions.snapshot(code);
        } catch (RuntimeException exception) {
            return null;
        }
    }

    private boolean send(String code, SseEmitter emitter, StudentSessionSnapshot snapshot) {
        try {
            emitter.send(SseEmitter.event().name("snapshot").data(snapshot));
            return true;
        } catch (IOException | IllegalStateException exception) {
            remove(code, emitter);
            return false;
        }
    }

    private void remove(String code, SseEmitter emitter) {
        Set<SseEmitter> set = emittersByCode.get(code);
        if (set != null) {
            set.remove(emitter);
            if (set.isEmpty()) {
                emittersByCode.remove(code, set);
            }
        }
    }
}
