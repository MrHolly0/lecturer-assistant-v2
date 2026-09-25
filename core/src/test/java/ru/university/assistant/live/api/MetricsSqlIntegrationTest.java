package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

import java.nio.file.Path;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

class MetricsSqlIntegrationTest extends LiveFlowTestBase {
    @Autowired
    DataSource dataSource;

    @Test
    void pilotMetricsScriptExecutesForTestLecture() throws Exception {
        jdbc.sql("update live.lectures set title = '[ТЕСТ] Лекция метрик' where id = :lectureId")
                .param("lectureId", java.util.UUID.fromString(lectureId))
                .update();

        String studentJwt = maxLogin(909);
        join(studentJwt, null);
        act("/api/v1/student/sessions/{joinCode}/signals", studentJwt, "{\"value\":\"RED\"}", 200);

        Path script = Path.of("..", "docs", "hackathon", "research", "metrics.sql")
                .toAbsolutePath()
                .normalize();
        assertDoesNotThrow(() -> {
            try (var connection = dataSource.getConnection()) {
                ScriptUtils.executeSqlScript(connection, new FileSystemResource(script));
            }
        });
    }
}
