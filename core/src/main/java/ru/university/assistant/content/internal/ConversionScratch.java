package ru.university.assistant.content.internal;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * At most eight attempts, each with a bounded input and 128 MiB output. Never part of published
 * blobs.
 */
@Component
@ConditionalOnProperty(name = "app.content.converter-url")
class ConversionScratch {
    private final JdbcClient jdbc;
    private final Path root;

    ConversionScratch(
            JdbcClient jdbc, @Value("${app.content.conversion-root:/data/conversion}") Path root) {
        this.jdbc = jdbc;
        this.root = root;
    }

    static Path reserve(Path root, UUID job, long inputBytes, DataSource dataSource)
            throws IOException {
        Files.createDirectories(root);
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try (PreparedStatement lock =
                    connection.prepareStatement("select pg_advisory_xact_lock(14713,2526)")) {
                lock.execute();
            }
            try (var entries = Files.list(root)) {
                if (entries.filter(p -> Files.isDirectory(p, LinkOption.NOFOLLOW_LINKS))
                                        .limit(8)
                                        .count()
                                >= 8
                        || Files.getFileStore(root).getUsableSpace()
                                < 4L * 1024 * 1024 * 1024 + inputBytes)
                    throw new RetryableImportException("Conversion scratch budget is busy", "30");
            }
            Path stage = Files.createDirectory(root.resolve(UUID.randomUUID().toString()));
            Files.setPosixFilePermissions(
                    stage, java.nio.file.attribute.PosixFilePermissions.fromString("rwxrwxrwx"));
            Files.writeString(stage.resolve(".job-id"), job.toString());
            connection.commit();
            return stage;
        } catch (SQLException error) {
            throw new IllegalStateException("Cannot reserve conversion scratch", error);
        }
    }

    @Scheduled(fixedDelay = 600000, initialDelay = 60000)
    public void clean() throws IOException {
        if (!Files.isDirectory(root)) return;
        try (var directories = Files.list(root)) {
            for (Path directory : directories.limit(1000).toList()) {
                if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)
                        || !directory.getFileName().toString().matches("[a-f0-9-]{36}")) continue;
                Path marker = directory.resolve(".job-id");
                if (!Files.isRegularFile(marker, LinkOption.NOFOLLOW_LINKS)
                        || Files.size(marker) > 64
                        || Files.getLastModifiedTime(marker)
                                .toInstant()
                                .isAfter(Instant.now().minusSeconds(1800))) continue;
                UUID job;
                try {
                    job = UUID.fromString(Files.readString(marker).trim());
                } catch (IllegalArgumentException ignored) {
                    continue;
                }
                boolean running =
                        jdbc.sql(
                                        "select exists(select 1 from content.import_jobs where id=:id and"
                                        + " status='RUNNING' and lease_until>now())")
                                .param("id", job)
                                .query(Boolean.class)
                                .single();
                if (running) continue;
                try (var files = Files.walk(directory)) {
                    for (Path file : files.sorted(java.util.Comparator.reverseOrder()).toList())
                        Files.deleteIfExists(file);
                } catch (java.nio.file.NoSuchFileException ignored) {
                    /* Another replica reclaimed this expired attempt. */
                }
            }
        }
    }
}
