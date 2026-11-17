package ru.university.assistant.iam.internal;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Keep a seven-day diagnostic grace; active cookies and educational history are untouched. */
@Component
class RefreshTokenMaintenance {
    private final JdbcClient jdbc;

    RefreshTokenMaintenance(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    @Scheduled(
            fixedDelayString = "${app.security.refresh-cleanup-delay-ms:60000}",
            initialDelayString = "${app.security.refresh-cleanup-delay-ms:60000}")
    public void clean() {
        jdbc.sql(
                        """
            delete from iam.refresh_tokens where id in (
              select id from iam.refresh_tokens
              where id in (
                (select id from iam.refresh_tokens where expires_at < now() - interval '7 days' order by
                expires_at limit 1000)
                union
                (select id from iam.refresh_tokens where revoked_at < now() - interval '7 days' order by
                revoked_at limit 1000)
              ) for update skip locked limit 1000)
            """)
                .update();
    }
}
