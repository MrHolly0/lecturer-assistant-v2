package ru.university.assistant.live.api;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import ru.university.assistant.content.internal.BlobStorage;

class BlobBackupCoordinationIntegrationTest extends LiveFlowTestBase {
    @Autowired
    DataSource dataSource;

    @Autowired
    BlobStorage blobs;

    @Test
    void independentWritersShareLockButBackupExcludesWrites() throws Exception {
        var pool = Executors.newSingleThreadExecutor();
        try (var guard = dataSource.getConnection(); var statement = guard.createStatement()) {
            statement.execute("select pg_advisory_lock_shared(14713, 2525)");
            try {
                var write = pool.submit(() -> blobs.storeBytes(
                        new byte[] {1}, "concurrent.bin", "application/octet-stream"));
                var stored = write.get(3, TimeUnit.SECONDS);
                assertNotNull(stored.ref());
                blobs.delete(stored.ref());
                try (var probe = dataSource.getConnection(); var sql = probe.createStatement();
                        var result = sql.executeQuery("select pg_try_advisory_lock(14713, 2525)")) {
                    result.next();
                    assertFalse(result.getBoolean(1), "backup must wait for active writers");
                }
            } finally {
                statement.execute("select pg_advisory_unlock_shared(14713, 2525)");
            }
            statement.execute("select pg_advisory_lock(14713, 2525)");
            var write = pool.submit(() -> blobs.storeBytes(
                    new byte[] {2}, "after-backup.bin", "application/octet-stream"));
            try {
                Thread.sleep(150);
                assertFalse(write.isDone(), "blob writer must wait until backup releases its snapshot");
            } finally {
                statement.execute("select pg_advisory_unlock(14713, 2525)");
            }
            blobs.delete(write.get(3, TimeUnit.SECONDS).ref());
        } finally {
            pool.shutdownNow();
        }
    }
}
