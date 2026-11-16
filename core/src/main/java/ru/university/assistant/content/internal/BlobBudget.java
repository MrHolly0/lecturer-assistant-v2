package ru.university.assistant.content.internal;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Reservations share the writer transaction and serialize across API/worker replicas. */
@Component
class BlobBudget {
    private final JdbcClient jdbc;
    private final long installationLimit;
    private final long courseLimit;
    private final long diskReserve;

    BlobBudget(
            JdbcClient jdbc,
            @Value("${app.content.storage-installation-bytes:21474836480}") long installationLimit,
            @Value("${app.content.storage-course-bytes:4294967296}") long courseLimit,
            @Value("${app.content.storage-disk-reserve-bytes:2147483648}") long diskReserve) {
        this.jdbc = jdbc;
        this.installationLimit = installationLimit;
        this.courseLimit = courseLimit;
        this.diskReserve = diskReserve;
    }

    void initialize(Path root) throws IOException {
        jdbc.sql("select singleton from content.storage_budget where singleton for update")
                .query(Boolean.class)
                .single();
        if (jdbc.sql("select initialized from content.storage_budget where singleton")
                .query(Boolean.class)
                .single()) return;
        if ("content-worker".equals(System.getenv("APP_ROLE")))
            throw new RetryableImportException("Storage accounting is initializing", "3");
        Files.createDirectories(root);
        Map<String, UUID> owners = new HashMap<>();
        jdbc.sql(
                        """
          select source_file_ref as ref,course_id from content.import_jobs
          union select source_file_ref,course_id from content.slide_decks
          union select s.image_ref,d.course_id from content.slides s join content.slide_decks d on d.id=s.deck_id
          union select a.file_ref,l.course_id from content.attachments a join live.lectures l on l.id=a.lecture_id
          """)
                .query(
                        (rs, n) -> {
                            owners.putIfAbsent(
                                    rs.getString("ref"), rs.getObject("course_id", UUID.class));
                            return 0;
                        })
                .list();
        Map<UUID, Long> courses = new HashMap<>();
        long total = 0;
        try (var files = Files.walk(root)) {
            for (Path file :
                    files.filter(
                                    p ->
                                            Files.isRegularFile(
                                                    p, java.nio.file.LinkOption.NOFOLLOW_LINKS))
                            .toList()) {
                String ref = root.relativize(file).toString().replace('\\', '/');
                long size = Files.size(file);
                UUID course = owners.get(ref);
                total = Math.addExact(total, size);
                jdbc.sql(
                                "insert into content.blob_usage(ref,course_id,bytes) values(:ref,:course,:bytes)")
                        .param("ref", ref)
                        .param("course", course)
                        .param("bytes", size)
                        .update();
                if (course != null) courses.merge(course, size, Long::sum);
            }
        }
        for (var entry : courses.entrySet())
            jdbc.sql(
                            "insert into content.course_storage_budget(course_id,bytes) values(:id,:bytes)")
                    .param("id", entry.getKey())
                    .param("bytes", entry.getValue())
                    .update();
        jdbc.sql("update content.storage_budget set initialized=true,bytes=:bytes where singleton")
                .param("bytes", total)
                .update();
    }

    void reserve(Path root, String ref, UUID course, long bytes) throws IOException {
        initialize(root);
        if (bytes < 0 || Files.getFileStore(root).getUsableSpace() - bytes < diskReserve)
            throw new ResponseStatusException(
                    HttpStatus.INSUFFICIENT_STORAGE, "Storage reserve reached");
        var old =
                jdbc
                        .sql("select bytes,course_id from content.blob_usage where ref=:ref")
                        .param("ref", ref)
                        .query()
                        .listOfRows()
                        .stream()
                        .findFirst();
        long previous = old.map(row -> ((Number) row.get("bytes")).longValue()).orElse(0L);
        long delta = bytes - previous;
        UUID previousCourse = old.map(row -> (UUID) row.get("course_id")).orElse(null);
        long courseDelta = java.util.Objects.equals(previousCourse, course) ? delta : bytes;
        if (previousCourse != null && !previousCourse.equals(course))
            jdbc.sql(
                            "update content.course_storage_budget set bytes=greatest(0,bytes-:bytes) where"
                            + " course_id=:id")
                    .param("bytes", previous)
                    .param("id", previousCourse)
                    .update();

        if (jdbc.sql(
                                "update content.storage_budget set bytes=bytes+:delta where singleton and"
                                + " bytes+:delta<=:max")
                        .param("delta", delta)
                        .param("max", installationLimit)
                        .update()
                != 1)
            throw new ResponseStatusException(
                    HttpStatus.INSUFFICIENT_STORAGE, "Installation storage quota reached");
        if (course != null) {
            jdbc.sql(
                            "insert into content.course_storage_budget(course_id) values(:id) on conflict do nothing")
                    .param("id", course)
                    .update();
            if (jdbc.sql(
                                    "update content.course_storage_budget set bytes=bytes+:delta where"
                                    + " course_id=:id and bytes+:delta<=:max")
                            .param("id", course)
                            .param("delta", courseDelta)
                            .param("max", courseLimit)
                            .update()
                    != 1)
                throw new ResponseStatusException(
                        HttpStatus.INSUFFICIENT_STORAGE, "Course storage quota reached");
        }
        jdbc.sql(
                        "insert into content.blob_usage(ref,course_id,bytes) values(:ref,:course,:bytes) on"
                        + " conflict(ref) do update set bytes=excluded.bytes,course_id=excluded.course_id")
                .param("ref", ref)
                .param("course", course)
                .param("bytes", bytes)
                .update();
    }

    UUID owner(String ref) {
        return jdbc.sql("select course_id from content.blob_usage where ref=:ref")
                .param("ref", ref)
                .query(UUID.class)
                .optional()
                .orElse(null);
    }

    void release(String ref) {
        jdbc.sql("select singleton from content.storage_budget where singleton for update")
                .query(Boolean.class)
                .single();
        var rows =
                jdbc.sql("delete from content.blob_usage where ref=:ref returning bytes,course_id")
                        .param("ref", ref)
                        .query()
                        .listOfRows();
        for (var row : rows) {
            jdbc.sql(
                            "update content.storage_budget set bytes=greatest(0,bytes-:bytes) where singleton")
                    .param("bytes", row.get("bytes"))
                    .update();
            if (row.get("course_id") != null)
                jdbc.sql(
                                "update content.course_storage_budget set bytes=greatest(0,bytes-:bytes) where"
                                + " course_id=:id")
                        .param("bytes", row.get("bytes"))
                        .param("id", row.get("course_id"))
                        .update();
        }
    }
}
