package ru.university.assistant.live.internal;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StudentSessionSnapshot;
import ru.university.assistant.qa.api.QuestionAnswerVisibility;

/**
 * Раздаёт персонализированные снапшоты одним планировщиком, а не потоком на студента.
 * Общие данные сессии загружаются один раз за тик, затем ответы фильтруются в памяти
 * по person id каждого зарегистрированного participant token.
 */
@Component
public class StudentSseBroadcaster {
    private static final Logger LOG = LoggerFactory.getLogger(StudentSseBroadcaster.class);
    private final Map<String, Set<Client>> clientsByCode = new ConcurrentHashMap<>();
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();
    private final StudentWebSessionService sessions;
    private final ExecutorService workers;

    StudentSseBroadcaster(
            StudentWebSessionService sessions,
            @Value("${app.live.sse-broadcast-workers:4}") int workerCount) {
        this.sessions = sessions;
        this.workers = Executors.newFixedThreadPool(Math.max(1, workerCount), task -> {
            Thread thread = new Thread(task, "student-sse-broadcast");
            thread.setDaemon(true);
            return thread;
        });
    }

    @PreDestroy
    void stop() {
        workers.shutdownNow();
    }

    public void register(String joinCode, UUID viewerPersonId, SseEmitter emitter) {
        String code = joinCode.trim().toUpperCase();
        Client client = new Client(viewerPersonId, emitter);
        Set<Client> set = clientsByCode.computeIfAbsent(code, key -> ConcurrentHashMap.newKeySet());
        set.add(client);
        emitter.onCompletion(() -> remove(code, client));
        emitter.onTimeout(() -> {
            LOG.debug("Student stream timed out for {}", code);
            emitter.complete();
            remove(code, client);
        });
        emitter.onError(error -> {
            LOG.debug("Student stream failed for {}: {}", code, error.toString());
            remove(code, client);
        });
        // The scheduled batch sends the first snapshot within one second. Doing a full
        // database read here for every joining student exhausts request workers in a burst.
    }

    public void registerPublic(String joinCode, SseEmitter emitter) {
        register(joinCode, null, emitter);
    }

    @Scheduled(fixedRate = 1000)
    void scheduleBroadcast() {
        if (workers.isShutdown()) return;
        for (String code : clientsByCode.keySet()) {
            if (!inFlight.add(code)) continue;
            workers.execute(() -> {
                try {
                    broadcastCode(code);
                } finally {
                    inFlight.remove(code);
                }
            });
        }
    }

    /** Synchronous entry point for deterministic delivery tests. */
    void broadcast() {
        for (String code : clientsByCode.keySet()) broadcastCode(code);
    }

    private void broadcastCode(String code) {
        Set<Client> set = clientsByCode.get(code);
        if (set == null) return;
        if (set.isEmpty()) {
            clientsByCode.remove(code, set);
            return;
        }
        Map<UUID, StudentSessionSnapshot> snapshots;
        StudentSessionSnapshot publicSnapshot;
        try {
            Set<UUID> viewers = set.stream()
                    .map(Client::viewerPersonId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            snapshots = viewers.isEmpty() ? Map.of() : sessions.snapshotsForViewers(code, viewers);
            publicSnapshot = set.stream().anyMatch(client -> client.viewerPersonId() == null)
                    ? sessions.snapshot(code) : null;
        } catch (RuntimeException exception) {
            if (exception instanceof ResponseStatusException status
                    && status.getStatusCode() == HttpStatus.NOT_FOUND) {
                set.forEach(client -> client.emitter().complete());
                clientsByCode.remove(code);
                return;
            }
            // A transient database timeout must not eject an entire lecture. The next tick retries.
            LOG.warn("Cannot prepare student stream snapshot for {}: {}", code, exception.toString());
            return;
        }
        boolean ended = false;
        for (Client client : set) {
            StudentSessionSnapshot snapshot = client.viewerPersonId() == null
                    ? publicSnapshot : snapshots.get(client.viewerPersonId());
            if (snapshot == null) {
                client.emitter().complete();
                remove(code, client);
                continue;
            }
            ended |= snapshot.status() == SessionStatus.ENDED || snapshot.status() == SessionStatus.ARCHIVED;
            boolean delivered = sendSnapshot(code, client, snapshot);
            if (ended && delivered) {
                client.emitter().complete();
            }
        }
        if (ended) {
            clientsByCode.remove(code);
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void publishAnswer(StudentQuestionAnswerPublished event) {
        String code = event.joinCode().trim().toUpperCase();
        Set<Client> clients = clientsByCode.getOrDefault(code, Set.of());
        for (Client client : clients) {
            boolean visible = event.answer().answerVisibility() == QuestionAnswerVisibility.SESSION
                    || client.viewerPersonId() != null
                            && client.viewerPersonId().equals(event.authorPersonId());
            if (visible) {
                send(code, client, "question-answer", event.answer());
            }
        }
    }

    private boolean send(String code, Client client, String eventName, Object data) {
        try {
            client.emitter().send(SseEmitter.event().name(eventName).data(data));
            return true;
        } catch (IOException | IllegalStateException exception) {
            LOG.debug("Student stream send failed for {}: {}", code, exception.toString());
            remove(code, client);
            return false;
        }
    }

    private boolean sendSnapshot(String code, Client client, StudentSessionSnapshot snapshot) {
        if (!snapshot.equals(client.lastSnapshot)) {
            boolean delivered = send(code, client, "snapshot", snapshot);
            if (delivered) {
                client.lastSnapshot = snapshot;
                client.nextHeartbeatAt = System.nanoTime() + java.time.Duration.ofSeconds(15).toNanos();
            }
            return delivered;
        }
        if (System.nanoTime() >= client.nextHeartbeatAt) {
            try {
                client.emitter.send(SseEmitter.event().comment("keepalive"));
                client.nextHeartbeatAt = System.nanoTime() + java.time.Duration.ofSeconds(15).toNanos();
            } catch (IOException | IllegalStateException exception) {
                remove(code, client);
                return false;
            }
        }
        return true;
    }

    private void remove(String code, Client client) {
        Set<Client> set = clientsByCode.get(code);
        if (set != null) {
            set.remove(client);
            if (set.isEmpty()) {
                clientsByCode.remove(code, set);
            }
        }
    }

    private static final class Client {
        private final UUID viewerPersonId;
        private final SseEmitter emitter;
        private volatile StudentSessionSnapshot lastSnapshot;
        private volatile long nextHeartbeatAt;

        private Client(UUID viewerPersonId, SseEmitter emitter) {
            this.viewerPersonId = viewerPersonId;
            this.emitter = emitter;
        }

        UUID viewerPersonId() { return viewerPersonId; }
        SseEmitter emitter() { return emitter; }
    }
}
