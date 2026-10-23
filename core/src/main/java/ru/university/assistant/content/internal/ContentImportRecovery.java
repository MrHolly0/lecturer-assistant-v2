package ru.university.assistant.content.internal;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.dao.DataAccessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/** The database is the queue. This process owns only the work it can start immediately. */
@Component
public class ContentImportRecovery {
    private static final Logger LOG = LoggerFactory.getLogger(ContentImportRecovery.class);
    private final UUID owner = UUID.randomUUID();
    private final Map<UUID, ContentRepository.ImportClaim> active = new ConcurrentHashMap<>();
    private final ContentRepository repository;
    private final SlideImportWorker worker;
    private final ThreadPoolTaskExecutor executor;
    private final boolean enabled;
    private final int leaseSeconds;
    private final int maxAttempts;
    private final AtomicInteger databaseFailures = new AtomicInteger();
    private volatile long nextDatabaseProbeNanos;

    ContentImportRecovery(ContentRepository repository, SlideImportWorker worker,
            @Qualifier("contentImportExecutor") ThreadPoolTaskExecutor executor,
            @Value("${app.content.worker-enabled:true}") boolean enabled,
            @Value("${app.content.import-lease-seconds:90}") int leaseSeconds,
            @Value("${app.content.import-max-attempts:3}") int maxAttempts) {
        this.repository = repository;
        this.worker = worker;
        this.executor = executor;
        this.enabled = enabled;
        this.leaseSeconds = Math.max(30, leaseSeconds);
        this.maxAttempts = Math.max(1, maxAttempts);
    }

    @Scheduled(fixedDelayString = "${app.content.import-dispatch-delay-ms:1000}")
    public synchronized void dispatch() {
        if (!enabled || System.nanoTime() < nextDatabaseProbeNanos) return;
        try {
            dispatchAvailable();
            if (databaseFailures.getAndSet(0) > 0) LOG.info("Import queue database connection restored");
            nextDatabaseProbeNanos = 0;
        } catch (DataAccessException unavailable) {
            deferDatabaseProbe();
        }
    }

    private void dispatchAvailable() {
        recoverInterruptedJobs();
        while (active.size() < executor.getMaxPoolSize()) {
            var next = repository.claimJob(owner, leaseSeconds);
            if (next.isEmpty()) {
                return;
            }
            var claim = next.get();
            active.put(claim.id(), claim);
            try {
                executor.execute(() -> {
                    try {
                        worker.process(claim);
                    } finally {
                        active.remove(claim.id(), claim);
                    }
                });
            } catch (TaskRejectedException exception) {
                active.remove(claim.id(), claim);
                // The lease expires and the persisted job becomes claimable again.
                LOG.warn("Import executor unavailable; persisted job {} will be recovered", claim.id());
                return;
            }
        }
    }

    public void recoverInterruptedJobs() {
        repository.recoverExpiredJobs(maxAttempts);
    }

    @Scheduled(fixedDelayString = "${app.content.import-heartbeat-delay-ms:10000}")
    public void heartbeat() {
        if (System.nanoTime() < nextDatabaseProbeNanos) return;
        try {
            active.values().forEach(claim -> repository.heartbeat(claim, leaseSeconds));
        } catch (DataAccessException unavailable) {
            deferDatabaseProbe();
        }
    }

    private void deferDatabaseProbe() {
        int failures = databaseFailures.incrementAndGet();
        long ceilingMillis = Math.min(30000, 1000L << Math.min(5, failures));
        long delayMillis = ThreadLocalRandom.current().nextLong(1000, ceilingMillis + 1);
        nextDatabaseProbeNanos = System.nanoTime() + delayMillis * 1_000_000;
        if (failures == 1) {
            LOG.warn("Import database unavailable; persisted jobs will be retried with backoff");
        }
    }
}
