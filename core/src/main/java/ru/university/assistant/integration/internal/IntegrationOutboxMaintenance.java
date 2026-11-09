package ru.university.assistant.integration.internal;

import java.util.concurrent.ThreadLocalRandom;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Reclaim delivered rows without ever locking all admission lanes in one transaction. */
@Component
class IntegrationOutboxMaintenance {
    private final JdbcClient jdbc;
    private final boolean enabled;
    private int cursor = ThreadLocalRandom.current().nextInt(64);
    private long retryAfter;

    IntegrationOutboxMaintenance(JdbcClient jdbc, @Value("${app.integration.enabled:false}") boolean enabled) {
        this.jdbc = jdbc; this.enabled = enabled;
    }

    @Scheduled(fixedDelay = 100)
    void clean() {
        if (!enabled || System.nanoTime() < retryAfter) return;
        try {
            for (int i = 0; i < 4; i++) release(cursor++ & 63);
        } catch (org.springframework.dao.DataAccessException unavailable) {
            retryAfter = System.nanoTime() + 5_000_000_000L;
        }
    }

    private void release(int lane) {
        jdbc.sql("""
                with budget as materialized (
                    select lane from integration.outbox_budgets where lane = :lane for update skip locked
                ), removed as (
                    delete from integration.outbox where id in (
                        select id from integration.outbox where status = 'DELIVERED'
                            and lane = (select lane from budget) order by created_at
                        for update skip locked limit 1024
                    ) returning charged_bytes
                ), totals as (
                    select count(*) as n, coalesce(sum(charged_bytes), 0) as bytes from removed
                ) update integration.outbox_budgets b
                    set pending_count = pending_count - t.n, pending_bytes = pending_bytes - t.bytes
                from totals t where b.lane = (select lane from budget) and t.n > 0
                """).param("lane", lane).update();
    }
}
