package ru.university.assistant.content.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import ru.university.assistant.content.api.ImportJobStatus;
import ru.university.assistant.shared.api.CommandIdempotency;

@Testcontainers
class DurableCommandsIntegrationTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private JdbcClient jdbc;
    private ContentRepository repository;
    private TransactionTemplate transactions;
    private CommandIdempotency commands;
    private UUID actor;
    private UUID course;

    @BeforeEach
    void prepare() {
        var dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        Flyway.configure().dataSource(dataSource).load().migrate();
        jdbc = JdbcClient.create(dataSource);
        jdbc.sql("truncate iam.persons cascade").update();
        repository = new ContentRepository(jdbc);
        transactions = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        commands = new CommandIdempotency(jdbc, transactions, new ObjectMapper().findAndRegisterModules());
        actor = UUID.randomUUID();
        course = UUID.randomUUID();
        jdbc.sql("""
                insert into iam.persons(id, display_name, email, password_hash, role, status)
                values (:id, 'Teacher', :email, 'unused', 'LECTURER', 'ACTIVE')
                """).param("id", actor).param("email", actor + "@example.test").update();
        addCourse(course, "Course");
    }

    @Test
    void twoWorkersClaimOnceAndOnlyExpiredOwnerCanBeRecovered() throws Exception {
        UUID id = UUID.randomUUID();
        repository.createJob(id, course, new StoredBlob("source.pdf", "source.pdf", "application/pdf", 10), "Test");
        CountDownLatch start = new CountDownLatch(1);
        ContentRepository.ImportClaim first;
        try (var threads = Executors.newFixedThreadPool(2)) {
            var one = threads.submit(() -> { start.await(); return repository.claimJob(UUID.randomUUID(), 60); });
            var two = threads.submit(() -> { start.await(); return repository.claimJob(UUID.randomUUID(), 60); });
            start.countDown();
            var a = one.get(10, TimeUnit.SECONDS);
            var b = two.get(10, TimeUnit.SECONDS);
            assertNotEquals(a.isPresent(), b.isPresent());
            first = a.orElseGet(b::orElseThrow);
        }
        assertEquals(0, repository.recoverExpiredJobs(3));
        assertTrue(repository.heartbeat(first, 60));
        transactions.executeWithoutResult(status -> repository.requireClaim(first));
        jdbc.sql("update content.import_jobs set lease_until = now() - interval '1 second' where id = :id")
                .param("id", id).update();
        assertFalse(repository.heartbeat(first, 60));
        assertEquals(1, repository.recoverExpiredJobs(3));
        jdbc.sql("update content.import_jobs set available_at = now() where id = :id").param("id", id).update();
        var recovered = repository.claimJob(UUID.randomUUID(), 60).orElseThrow();
        assertNotEquals(first.token(), recovered.token());
        assertThrows(ContentRepository.LostImportClaimException.class,
                () -> transactions.executeWithoutResult(status -> repository.requireClaim(first)));
        assertFalse(repository.markJob(id, ImportJobStatus.COMPLETED, 100, "COMPLETED", 1, 1,
                null, null, null, first.token()));
        assertTrue(repository.markJob(id, ImportJobStatus.COMPLETED, 100, "COMPLETED", 1, 1,
                null, null, null, recovered.token()));
        assertEquals(ImportJobStatus.COMPLETED, repository.findJob(course, id).orElseThrow().status());
    }

    @Test
    void pendingWorkSurvivesRecoveryAndAttemptsAreBounded() {
        UUID id = UUID.randomUUID();
        repository.createJob(id, course, new StoredBlob("source.pdf", "source.pdf", "application/pdf", 10), "Test");
        assertEquals(0, repository.recoverExpiredJobs(3));
        assertEquals(ImportJobStatus.PENDING, repository.findJob(course, id).orElseThrow().status());
        repository.claimJob(UUID.randomUUID(), 60).orElseThrow();
        jdbc.sql("""
                update content.import_jobs set lease_until = now() - interval '1 second',
                    attempts = 3, processed_slides = 2 where id = :id
                """).param("id", id).update();
        assertEquals(1, repository.recoverExpiredJobs(3));
        assertEquals(ImportJobStatus.PARTIAL, repository.findJob(course, id).orElseThrow().status());
        assertTrue(repository.claimJob(UUID.randomUUID(), 60).isEmpty());
    }

    @Test
    void concurrentRetryReplaysOneCommittedEffectAndPayloadMismatchConflicts() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        CountDownLatch start = new CountDownLatch(1);
        String operation = "POST /courses/create";
        java.util.function.Supplier<UUID> command = () -> {
            calls.incrementAndGet();
            UUID id = UUID.randomUUID();
            addCourse(id, "Created once");
            return id;
        };
        try (var threads = Executors.newFixedThreadPool(2)) {
            var one = threads.submit(() -> { start.await(); return commands.execute(actor, operation, "key",
                    commands.hash("same"), UUID.class, command); });
            var two = threads.submit(() -> { start.await(); return commands.execute(actor, operation, "key",
                    commands.hash("same"), UUID.class, command); });
            start.countDown();
            assertEquals(one.get(10, TimeUnit.SECONDS), two.get(10, TimeUnit.SECONDS));
        }
        assertEquals(1, calls.get());
        assertEquals(1, jdbc.sql("select count(*) from org.courses where title = 'Created once'")
                .query(Integer.class).single());
        var conflict = assertThrows(ResponseStatusException.class, () -> commands.execute(actor, operation,
                "key", commands.hash("changed"), UUID.class, command));
        assertEquals(409, conflict.getStatusCode().value());
    }

    @Test
    void failedCommandRollsBackEffectsAndKeyCanBeRetriedAndExpires() {
        UUID failed = UUID.randomUUID();
        assertThrows(IllegalStateException.class, () -> commands.execute(actor, "create", "retry-key",
                commands.hash("request"), UUID.class, () -> {
                    addCourse(failed, "Rolled back");
                    throw new IllegalStateException("response lost before commit");
                }));
        assertEquals(0, jdbc.sql("select count(*) from org.courses where id = :id").param("id", failed)
                .query(Integer.class).single());
        UUID result = commands.execute(actor, "create", "retry-key", commands.hash("request"), UUID.class,
                () -> { addCourse(failed, "Retry"); return failed; });
        assertEquals(failed, result);
        jdbc.sql("update shared.command_idempotency set expires_at = now() - interval '1 second'").update();
        commands.cleanExpired();
        assertEquals(0, jdbc.sql("select count(*) from shared.command_idempotency").query(Integer.class).single());
        UUID fresh = commands.execute(actor, "create", "retry-key", commands.hash("new request"), UUID.class,
                UUID::randomUUID);
        assertNotEquals(failed, fresh);
    }

    @Test
    void concurrentImportAndCopyVersionAllocationUseOneTitleSequence() throws Exception {
        var source = new StoredBlob("source.pdf", "source.pdf", "application/pdf", 10);
        UUID firstJob = UUID.randomUUID();
        UUID secondJob = UUID.randomUUID();
        repository.createJob(firstJob, course, source, "Shared title");
        repository.createJob(secondJob, course, source, "Shared title");
        CountDownLatch start = new CountDownLatch(1);
        try (var threads = Executors.newFixedThreadPool(2)) {
            var first = threads.submit(() -> {
                start.await();
                return transactions.execute(status -> {
                    int version = repository.nextDeckVersion(course, "Shared title");
                    repository.createDeck(UUID.randomUUID(), course, "Shared title", version, source, firstJob);
                    return version;
                });
            });
            var second = threads.submit(() -> {
                start.await();
                return transactions.execute(status -> {
                    int version = repository.nextDeckVersion(course, "Shared title");
                    repository.createDeck(UUID.randomUUID(), course, "Shared title", version, source, secondJob);
                    return version;
                });
            });
            start.countDown();
            assertNotEquals(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
        }
        assertEquals(java.util.List.of(1, 2), jdbc.sql("select version from content.slide_decks order by version")
                .query(Integer.class).list());
    }

    private void addCourse(UUID id, String title) {
        jdbc.sql("insert into org.courses(id, owner_person_id, title) values (:id, :actor, :title)")
                .param("id", id).param("actor", actor).param("title", title).update();
    }
}
