package ru.university.assistant.live.internal;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AccountAccessRevoked;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StudentSessionSnapshot;
import ru.university.assistant.qa.api.QuestionAnswerVisibility;

/**
 * Broadcasts the latest authoritative snapshot through fixed-size workers. Each client holds
 * one replaceable snapshot and a small bounded queue for non-snapshot events.
 */
@Component
public class StudentSseBroadcaster {
    private static final Logger LOG = LoggerFactory.getLogger(StudentSseBroadcaster.class);
    private static final int MAX_PENDING_ANSWERS = 8;
    private static final long WRITE_TIMEOUT_NANOS = Duration.ofSeconds(15).toNanos();
    private final Map<String, Set<Client>> clientsByCode = new ConcurrentHashMap<>();
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();
    private final StudentWebSessionService sessions;
    private final ThreadPoolExecutor broadcastWorkers;
    private final ThreadPoolExecutor sendWorkers;
    private final ThreadPoolExecutor closeWorkers;
    private final AtomicInteger activeClients = new AtomicInteger();
    private final AtomicInteger slowClients = new AtomicInteger();
    private final Counter slowConsumerCounter;
    private final Timer writeTimer;

    @Autowired
    StudentSseBroadcaster(
            StudentWebSessionService sessions,
            @Value("${app.live.sse-broadcast-workers:4}") int workerCount,
            MeterRegistry meters) {
        this(sessions, workerCount, meters, true);
    }

    StudentSseBroadcaster(StudentWebSessionService sessions, int workerCount) {
        this(sessions, workerCount, null, false);
    }

    private StudentSseBroadcaster(
            StudentWebSessionService sessions, int workerCount, MeterRegistry meters, boolean registerMeters) {
        this.sessions = sessions;
        int workers = Math.max(1, workerCount);
        this.broadcastWorkers = new ThreadPoolExecutor(
                workers, workers, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(64),
                task -> daemon("student-sse-snapshot", task), new ThreadPoolExecutor.AbortPolicy());
        this.sendWorkers = new ThreadPoolExecutor(
                workers, workers, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(2048),
                task -> daemon("student-sse-send", task), new ThreadPoolExecutor.AbortPolicy());
        this.closeWorkers = new ThreadPoolExecutor(
                2, 2, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(2048),
                task -> daemon("student-sse-close", task), new ThreadPoolExecutor.AbortPolicy());
        if (registerMeters) {
            meters.gauge("live.sse.clients", activeClients);
            meters.gauge("live.sse.slow_clients", slowClients);
            this.slowConsumerCounter = Counter.builder("live.sse.slow_consumer_disconnects").register(meters);
            this.writeTimer = Timer.builder("live.sse.write").register(meters);
        } else {
            this.slowConsumerCounter = null;
            this.writeTimer = null;
        }
    }

    @PreDestroy
    void stop() {
        broadcastWorkers.shutdownNow();
        sendWorkers.shutdownNow();
        closeWorkers.shutdownNow();
    }

    public void register(String joinCode, UUID viewerPersonId, SseEmitter emitter) {
        String code = joinCode.trim().toUpperCase();
        Client client = new Client(viewerPersonId, emitter);
        Set<Client> set = clientsByCode.computeIfAbsent(code, key -> ConcurrentHashMap.newKeySet());
        if (set.add(client)) activeClients.incrementAndGet();
        emitter.onCompletion(() -> remove(code, client));
        emitter.onTimeout(() -> {
            LOG.debug("Student stream timed out for {}", code);
            closeClient(code, client, null);
        });
        emitter.onError(error -> {
            LOG.debug("Student stream failed for {}: {}", code, error.toString());
            remove(code, client);
        });
    }

    public void registerPublic(String joinCode, SseEmitter emitter) {
        register(joinCode, null, emitter);
    }

    @Scheduled(fixedRate = 1000)
    void scheduleBroadcast() {
        if (broadcastWorkers.isShutdown()) return;
        for (String code : clientsByCode.keySet()) {
            if (!inFlight.add(code)) continue;
            try {
                broadcastWorkers.execute(() -> {
                    try {
                        broadcastCode(code);
                    } finally {
                        inFlight.remove(code);
                    }
                });
            } catch (RejectedExecutionException exception) {
                inFlight.remove(code);
                LOG.debug("Skipping SSE snapshot tick because the bounded worker queue is full");
            }
        }
    }

    /** Synchronous snapshot collection entry point for deterministic unit tests. */
    void broadcast() {
        for (String code : clientsByCode.keySet()) broadcastCode(code);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void closeRevokedAccountStreams(AccountAccessRevoked event) {
        clientsByCode.forEach((code, clients) -> clients.stream()
                .filter(client -> event.personId().equals(client.viewerPersonId()))
                .toList()
                .forEach(client -> {
                    client.pendingAnswers.clear();
                    client.latestSnapshot.set(null);
                    closeClient(code, client, new IOException("Account access was revoked"));
                }));
    }

    @Scheduled(fixedDelay = 1000)
    void detachSlowConsumers() {
        long now = System.nanoTime();
        clientsByCode.forEach((code, clients) -> clients.forEach(client -> {
            long sendingSince = client.sendingSinceNanos.get();
            if (sendingSince != 0 && now - sendingSince > WRITE_TIMEOUT_NANOS) {
                if (client.markSlow()) {
                    slowClients.incrementAndGet();
                    if (slowConsumerCounter != null) slowConsumerCounter.increment();
                }
                LOG.warn("Closing slow SSE consumer for {} after write deadline", code);
                closeClient(code, client, new IOException("SSE write exceeded deadline"));
            }
        }));
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
                set.forEach(client -> {
                    closeClient(code, client, null);
                });
                return;
            }
            LOG.warn("Cannot prepare student stream snapshot for {}: {}", code, exception.toString());
            return;
        }
        for (Client client : set) {
            StudentSessionSnapshot snapshot = client.viewerPersonId() == null
                    ? publicSnapshot : snapshots.get(client.viewerPersonId());
            if (snapshot == null) {
                closeClient(code, client, null);
                continue;
            }
            if (!snapshot.equals(client.lastSnapshot)) {
                boolean ended = snapshot.status() == SessionStatus.ENDED || snapshot.status() == SessionStatus.ARCHIVED;
                client.latestSnapshot.set(new PendingEvent("snapshot", snapshot, ended));
                scheduleSend(code, client);
            } else if (System.nanoTime() >= client.nextHeartbeatAt) {
                client.latestSnapshot.set(new PendingEvent("keepalive", null, false));
                scheduleSend(code, client);
            }
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void publishAnswer(StudentQuestionAnswerPublished event) {
        String code = event.joinCode().trim().toUpperCase();
        Set<Client> clients = clientsByCode.getOrDefault(code, Set.of());
        for (Client client : clients) {
            boolean canReceive = client.viewerPersonId() == null
                    || sessions.canReceive(code, client.viewerPersonId());
            boolean visible = event.answer().answerVisibility() == QuestionAnswerVisibility.SESSION
                            && canReceive
                    || client.viewerPersonId() != null
                            && client.viewerPersonId().equals(event.authorPersonId()) && canReceive;
            if (visible && !client.pendingAnswers.offer(new PendingEvent("question-answer", event.answer(), false))) {
                closeSlowConsumer(code, client, "SSE answer queue is full");
            } else if (visible) {
                scheduleSend(code, client);
            }
        }
    }

    private void scheduleSend(String code, Client client) {
        if (client.closed.get()) return;
        if (!client.sending.compareAndSet(false, true)) return;
        try {
            sendWorkers.execute(() -> drain(code, client));
        } catch (RejectedExecutionException exception) {
            client.sending.set(false);
            closeSlowConsumer(code, client, "SSE send queue is full");
        }
    }

    private void drain(String code, Client client) {
        try {
            while (true) {
                PendingEvent event = client.pendingAnswers.poll();
                if (event == null) event = client.latestSnapshot.getAndSet(null);
                if (event == null) return;
                if (client.closed.get()) return;
                client.sendingSinceNanos.set(System.nanoTime());
                long started = System.nanoTime();
                boolean sent;
                try {
                    if ("keepalive".equals(event.name())) {
                        client.emitter.send(SseEmitter.event().comment("keepalive"));
                        client.nextHeartbeatAt = System.nanoTime() + Duration.ofSeconds(15).toNanos();
                        sent = true;
                    } else {
                        client.emitter.send(SseEmitter.event().name(event.name()).data(event.data()));
                        sent = true;
                        if ("snapshot".equals(event.name())) {
                            client.lastSnapshot = (StudentSessionSnapshot) event.data();
                            client.nextHeartbeatAt = System.nanoTime() + Duration.ofSeconds(15).toNanos();
                        }
                    }
                } catch (IOException | IllegalStateException exception) {
                    LOG.debug("Student stream send failed for {}: {}", code, exception.toString());
                    remove(code, client);
                    return;
                } finally {
                    client.sendingSinceNanos.set(0);
                    if (writeTimer != null) writeTimer.record(System.nanoTime() - started, TimeUnit.NANOSECONDS);
                }
                if (sent && event.closeAfter()) {
                    closeClient(code, client, null);
                    return;
                }
            }
        } finally {
            client.sending.set(false);
            if (!client.closed.get()
                    && (!client.pendingAnswers.isEmpty() || client.latestSnapshot.get() != null)) {
                scheduleSend(code, client);
            }
        }
    }

    private void closeSlowConsumer(String code, Client client, String reason) {
        if (client.markSlow()) {
            slowClients.incrementAndGet();
            if (slowConsumerCounter != null) slowConsumerCounter.increment();
        }
        LOG.warn("Closing slow SSE consumer for {}: {}", code, reason);
        closeClient(code, client, new IOException(reason));
    }

    private void closeClient(String code, Client client, Throwable error) {
        if (!remove(code, client)) return;
        try {
            closeWorkers.execute(() -> {
                try {
                    if (error == null) client.emitter.complete();
                    else client.emitter.completeWithError(error);
                } catch (RuntimeException exception) {
                    LOG.debug("Student stream close failed for {}: {}", code, exception.toString());
                }
            });
        } catch (RejectedExecutionException exception) {
            LOG.warn("SSE close queue is full; detached stream {} will close on container timeout", code);
        }
    }

    private boolean remove(String code, Client client) {
        if (!client.closed.compareAndSet(false, true)) return false;
        client.pendingAnswers.clear();
        client.latestSnapshot.set(null);
        Set<Client> set = clientsByCode.get(code);
        if (set != null && set.remove(client)) {
            activeClients.decrementAndGet();
            if (client.slow.get()) slowClients.decrementAndGet();
        }
        if (set != null && set.isEmpty()) clientsByCode.remove(code, set);
        return true;
    }

    private static Thread daemon(String name, Runnable task) {
        Thread thread = new Thread(task, name);
        thread.setDaemon(true);
        return thread;
    }

    private static final class Client {
        private final UUID viewerPersonId;
        private final SseEmitter emitter;
        private final AtomicReference<PendingEvent> latestSnapshot = new AtomicReference<>();
        private final ArrayBlockingQueue<PendingEvent> pendingAnswers = new ArrayBlockingQueue<>(MAX_PENDING_ANSWERS);
        private final AtomicBoolean sending = new AtomicBoolean();
        private final AtomicBoolean slow = new AtomicBoolean();
        private final AtomicBoolean closed = new AtomicBoolean();
        private final AtomicLong sendingSinceNanos = new AtomicLong();
        private volatile StudentSessionSnapshot lastSnapshot;
        private volatile long nextHeartbeatAt;

        private Client(UUID viewerPersonId, SseEmitter emitter) {
            this.viewerPersonId = viewerPersonId;
            this.emitter = emitter;
        }

        boolean markSlow() { return slow.compareAndSet(false, true); }
        UUID viewerPersonId() { return viewerPersonId; }
        SseEmitter emitter() { return emitter; }
    }

    private record PendingEvent(String name, Object data, boolean closeAfter) {}
}
