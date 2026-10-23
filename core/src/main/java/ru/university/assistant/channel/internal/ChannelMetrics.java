package ru.university.assistant.channel.internal;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** One bounded set of queue gauges; never tag recipients or message ids. */
@Component
class ChannelMetrics {
    private final JdbcClient jdbc;
    private final Map<String, AtomicLong> counts = Map.of(
            "QUEUED", new AtomicLong(), "FAILED", new AtomicLong(),
            "IN_FLIGHT", new AtomicLong(), "DLQ", new AtomicLong());
    private final AtomicLong oldestAge = new AtomicLong();

    ChannelMetrics(JdbcClient jdbc, MeterRegistry meters) {
        this.jdbc = jdbc;
        counts.forEach((status, count) -> meters.gauge(
                "channel.outbox.messages", java.util.List.of(
                        io.micrometer.core.instrument.Tag.of("state", status)), count));
        meters.gauge("channel.outbox.oldest_age.seconds", oldestAge);
    }

    @Scheduled(fixedDelayString = "${app.channel.metrics-delay-ms:15000}", initialDelay = 15000)
    void refresh() {
        var rows = jdbc.sql("""
                select status, count(*) as total,
                    greatest(0, extract(epoch from (now() - min(created_at))))::bigint as age
                from channel.outbox where status in ('QUEUED', 'FAILED', 'IN_FLIGHT', 'DLQ') group by status
                """).query((rs, row) -> new QueueState(rs.getString("status"), rs.getLong("total"), rs.getLong("age")))
                .list();
        counts.values().forEach(value -> value.set(0));
        long oldest = 0;
        for (var row : rows) {
            counts.get(row.status()).set(row.total());
            if (!"DLQ".equals(row.status())) oldest = Math.max(oldest, row.age());
        }
        oldestAge.set(oldest);
    }

    private record QueueState(String status, long total, long age) {}
}
