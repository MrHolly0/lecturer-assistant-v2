package ru.university.assistant.content.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(
        properties = {
            "app.content.storage-installation-bytes=1000",
            "app.content.storage-course-bytes=700",
            "app.content.storage-disk-reserve-bytes=0"
        })
@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class StorageBudgetIntegrationTest {
    @Container
    static PostgreSQLContainer<?> database = new PostgreSQLContainer<>("postgres:16-alpine");

    static final Path root =
            Path.of(System.getProperty("java.io.tmpdir"), "budget-test-" + UUID.randomUUID());

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", database::getJdbcUrl);
        r.add("spring.datasource.username", database::getUsername);
        r.add("spring.datasource.password", database::getPassword);
        r.add("app.content.blob-root", root::toString);
        r.add(
                "app.security.jwt-secret",
                () -> "isolated-storage-test-secret-at-least-32-characters");
    }

    @Autowired BlobStorage storage;
    @Autowired JdbcClient jdbc;
    @Autowired TransactionTemplate transactions;
    @Autowired ContentProperties properties;

    @Autowired javax.sql.DataSource dataSource;
    @Autowired com.fasterxml.jackson.databind.ObjectMapper json;

    @Test
    void conversionStagesOnlyItsInputAndDoesNotHoldTheBackupLockWhileWaitingForNativeWork()
            throws Exception {
        Path scratch = Files.createTempDirectory("conversion-protocol-");
        var ready = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        var server =
                com.sun.net.httpserver.HttpServer.create(
                        new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/convert",
                exchange -> {
                    try {
                        assertEquals(
                                "a".repeat(64),
                                exchange.getRequestHeaders().getFirst("X-Converter-Key"));
                        var request = json.readTree(exchange.getRequestBody());
                        Path stage = Path.of(request.get("outputDir").asText());
                        assertEquals(scratch, stage.getParent());
                        assertEquals(stage.getFileName().toString(), request.get("jobId").asText());
                        assertEquals(
                                stage, Path.of(request.get("sourcePath").asText()).getParent());
                        ready.countDown();
                        assertTrue(release.await(5, java.util.concurrent.TimeUnit.SECONDS));
                        Files.createDirectories(stage.resolve("output"));
                        Files.write(stage.resolve("output/slide-1.png"), new byte[] {1, 2, 3});
                        byte[] response =
                                ("{\"type\":\"metadata\",\"totalSlides\":1,\"renderedSlides\":0}\n"
                                                + "{\"type\":\"slide\",\"index\":1,\"imageRef\":\"outpu"
                                                + "t/slide-1.png\",\"textExtract\":\"Text\",\"processed"
                                                + "Slides\":1,\"totalSlides\":1}\n"
                                                + "{\"type\":\"done\",\"totalSlides\":1,\"renderedSlides\":1}\n")
                                        .getBytes(java.nio.charset.StandardCharsets.UTF_8);
                        exchange.sendResponseHeaders(200, response.length);
                        exchange.getResponseBody().write(response);
                    } catch (Exception error) {
                        throw new RuntimeException(error);
                    } finally {
                        exchange.close();
                    }
                });
        server.start();
        var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
        var source =
                storage.storeForCourse(
                        UUID.randomUUID(),
                        new ByteArrayInputStream(new byte[8]),
                        "input.pdf",
                        "application/pdf",
                        8);
        String prefix = "converted-" + UUID.randomUUID();
        try {
            var config =
                    new ContentProperties(
                            root,
                            "http://127.0.0.1:" + server.getAddress().getPort(),
                            1000,
                            "unused",
                            java.time.Duration.ofHours(1),
                            java.time.Duration.ofSeconds(1),
                            java.time.Duration.ofSeconds(10),
                            1,
                            1,
                            1,
                            128);
            var client =
                    new HttpSlideConversionClient(
                            storage,
                            config,
                            org.springframework.web.client.RestClient.builder(),
                            json,
                            dataSource,
                            scratch,
                            "a".repeat(64));
            var slides = new java.util.ArrayList<ConvertedSlide>();
            var future =
                    executor.submit(
                            () ->
                                    client.convert(
                                            source,
                                            prefix,
                                            UUID.randomUUID(),
                                            new SlideConversionSink() {
                                                public void metadata(
                                                        int total,
                                                        int rendered,
                                                        String phase,
                                                        String warning) {}

                                                public void slide(
                                                        ConvertedSlide slide,
                                                        int processed,
                                                        int total) {
                                                    slides.add(slide);
                                                }
                                            }));
            assertTrue(ready.await(5, java.util.concurrent.TimeUnit.SECONDS));
            try (var connection = dataSource.getConnection();
                    var query = connection.createStatement()) {
                try (var result = query.executeQuery("select pg_try_advisory_lock(14713,2525)")) {
                    assertTrue(result.next());
                    assertTrue(
                            result.getBoolean(1),
                            "Native render must not hold the backup snapshot lock");
                }
                query.execute("select pg_advisory_unlock(14713,2525)");
            }
            release.countDown();
            future.get(5, java.util.concurrent.TimeUnit.SECONDS);
            assertEquals(prefix + "/slide-1.png", slides.getFirst().imageRef());
            assertTrue(Files.exists(root.resolve(slides.getFirst().imageRef())));
            try (var files = Files.list(scratch)) {
                assertEquals(0L, files.count());
            }
            storage.delete(slides.getFirst().imageRef());
        } finally {
            release.countDown();
            executor.shutdownNow();
            server.stop(0);
            storage.delete(source.ref());
            Files.deleteIfExists(scratch);
        }
    }

    @Test
    void concurrentReservationsCannotOvercommitAndReleaseRestoresCapacity() throws Exception {
        UUID course = UUID.randomUUID();
        var first =
                storage.storeForCourse(
                        course, new ByteArrayInputStream(new byte[400]), "first.bin", null, 400);
        var denied =
                assertThrows(
                        org.springframework.web.server.ResponseStatusException.class,
                        () ->
                                storage.storeForCourse(
                                        course,
                                        new ByteArrayInputStream(new byte[350]),
                                        "course.bin",
                                        null,
                                        350));
        assertEquals(507, denied.getStatusCode().value());
        assertTrue(denied.getReason().contains("Course"));
        var executor = java.util.concurrent.Executors.newFixedThreadPool(2);
        var start = new java.util.concurrent.CountDownLatch(1);
        var jobs = new java.util.ArrayList<java.util.concurrent.Future<StoredBlob>>();
        try {
            for (int i = 0; i < 2; i++)
                jobs.add(
                        executor.submit(
                                () -> {
                                    start.await();
                                    try {
                                        return storage.storeForCourse(
                                                UUID.randomUUID(),
                                                new ByteArrayInputStream(new byte[400]),
                                                "other.bin",
                                                null,
                                                400);
                                    } catch (
                                            org.springframework.web.server.ResponseStatusException
                                                    full) {
                                        assertEquals(507, full.getStatusCode().value());
                                        return null;
                                    }
                                }));
            start.countDown();
            int success = 0;
            StoredBlob winner = null;
            for (var job : jobs) {
                var result = job.get(5, java.util.concurrent.TimeUnit.SECONDS);
                if (result != null) {
                    success++;
                    winner = result;
                }
            }
            assertEquals(1, success);
            assertEquals(
                    800L,
                    jdbc.sql("select bytes from content.storage_budget where singleton")
                            .query(Long.class)
                            .single());
            storage.delete(first.ref());
            storage.delete(winner.ref());
            assertEquals(
                    0L,
                    jdbc.sql("select bytes from content.storage_budget where singleton")
                            .query(Long.class)
                            .single());
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void outerBusinessRollbackRemovesTheFileAlongWithItsReservation() throws Exception {
        long before =
                jdbc.sql("select bytes from content.storage_budget where singleton")
                        .query(Long.class)
                        .single();
        java.util.concurrent.atomic.AtomicReference<StoredBlob> created =
                new java.util.concurrent.atomic.AtomicReference<>();
        transactions.executeWithoutResult(
                status -> {
                    try {
                        created.set(
                                storage.storeForCourse(
                                        UUID.randomUUID(),
                                        new ByteArrayInputStream(new byte[8]),
                                        "attachment.bin",
                                        null,
                                        8));
                        assertTrue(Files.exists(root.resolve(created.get().ref())));
                        status.setRollbackOnly();
                    } catch (java.io.IOException error) {
                        throw new java.io.UncheckedIOException(error);
                    }
                });
        assertFalse(Files.exists(root.resolve(created.get().ref())));
        assertEquals(
                before,
                jdbc.sql("select bytes from content.storage_budget where singleton")
                        .query(Long.class)
                        .single());
    }

    @Test
    void spoofedLengthRollsBackAndLowDiskReserveFailsBeforeWriting() throws Exception {
        long before =
                jdbc.sql("select bytes from content.storage_budget where singleton")
                        .query(Long.class)
                        .single();
        assertThrows(
                java.io.IOException.class,
                () -> storage.store(new ByteArrayInputStream(new byte[11]), "bad.bin", null, 10));
        assertEquals(
                before,
                jdbc.sql("select bytes from content.storage_budget where singleton")
                        .query(Long.class)
                        .single());
        BlobBudget lowDisk = new BlobBudget(jdbc, 1000, 700, Long.MAX_VALUE);
        var guarded = new FsBlobStorage(properties, jdbc, transactions, lowDisk);
        assertThrows(
                org.springframework.web.server.ResponseStatusException.class,
                () -> guarded.store(new ByteArrayInputStream(new byte[1]), "reserve.bin", null, 1));
        assertEquals(
                before,
                jdbc.sql("select bytes from content.storage_budget where singleton")
                        .query(Long.class)
                        .single());
        try (var files = Files.walk(root)) {
            assertFalse(files.anyMatch(p -> p.getFileName().toString().equals("bad.bin")));
        }
    }
}
