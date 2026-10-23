package ru.university.assistant.live.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import ru.university.assistant.shared.api.CapacityUnavailableException;
import ru.university.assistant.live.api.LectureSummary;
import ru.university.assistant.live.api.LiveSession;

/** Rebuildable PostgreSQL read model. A fingerprint is read before building, never after it. */
@Component
public class PreparedLectureSummary {
    private static final int SCHEMA_VERSION = 1;
    private static final int MAXIMUM_PAYLOAD_BYTES = 8 * 1024 * 1024;
    private final JdbcClient jdbc;
    private final ObjectMapper mapper;
    private final MeterRegistry meters;

    PreparedLectureSummary(JdbcClient jdbc, ObjectMapper mapper, MeterRegistry meters) {
        this.jdbc = jdbc; this.mapper = mapper; this.meters = meters;
    }

    LectureSummary get(LiveSession session, Supplier<LectureSummary> build) {
        long revision = jdbc.sql("""
                select coalesce(sum(revision), 0)::bigint from live.student_snapshot_revisions
                where session_id = :session
                """).param("session", session.id()).query(Long.class).single();
        String fingerprint = fingerprint(session, revision);
        Optional<LectureSummary> cached = find(session.id(), fingerprint);
        if (cached.isPresent()) {
            meters.counter("analytics.summary_cache", "result", "hit").increment();
            return cached.get();
        }
        // Only one builder per session across core instances, and no wait while holding a servlet thread.
        boolean locked = jdbc.sql("select pg_try_advisory_xact_lock(hashtextextended(:key, 0))")
                .param("key", "lecture-summary:" + session.id()).query(Boolean.class).single();
        if (!locked) {
            throw new CapacityUnavailableException(HttpStatus.SERVICE_UNAVAILABLE, "Summary is being prepared", 2);
        }
        cached = find(session.id(), fingerprint);
        if (cached.isPresent()) return cached.get();
        meters.counter("analytics.summary_cache", "result", "miss").increment();
        LectureSummary summary = meters.timer("analytics.summary_build").record(build);
        String payload = json(summary);
        if (payload.getBytes(StandardCharsets.UTF_8).length <= MAXIMUM_PAYLOAD_BYTES) {
            jdbc.sql("""
                    insert into analytics.lecture_summaries
                        (session_id, source_fingerprint, schema_version, payload)
                    values (:session, :fingerprint, :schema, cast(:payload as jsonb))
                    on conflict (session_id) do update set source_fingerprint = excluded.source_fingerprint,
                        schema_version = excluded.schema_version, payload = excluded.payload, prepared_at = now()
                    """).param("session", session.id()).param("fingerprint", fingerprint)
                    .param("schema", SCHEMA_VERSION).param("payload", payload).update();
        }
        return summary;
    }

    private Optional<LectureSummary> find(UUID session, String fingerprint) {
        return jdbc.sql("""
                select payload::text from analytics.lecture_summaries
                where session_id = :session and source_fingerprint = :fingerprint and schema_version = :schema
                """).param("session", session).param("fingerprint", fingerprint).param("schema", SCHEMA_VERSION)
                .query(String.class).optional().flatMap(payload -> {
                    try { return Optional.of(mapper.readValue(payload, LectureSummary.class)); }
                    catch (JsonProcessingException corrupted) { return Optional.empty(); }
                });
    }

    @Transactional
    public void invalidate(UUID sessionId) {
        boolean locked = jdbc.sql("select pg_try_advisory_xact_lock(hashtextextended(:key, 0))")
                .param("key", "lecture-summary:" + sessionId).query(Boolean.class).single();
        if (!locked) {
            throw new CapacityUnavailableException(HttpStatus.SERVICE_UNAVAILABLE, "Summary is being prepared", 2);
        }
        jdbc.sql("delete from analytics.lecture_summaries where session_id = :session")
                .param("session", sessionId).update();
    }

    private String fingerprint(LiveSession session, long revision) {
        // timingCalculatedAt changes on reads; the finalized durations and metadata are the source state.
        var source = new Source(revision, session.version(), session.lectureId(), session.lectureTitle(),
                session.groups(),
                session.status().name(), session.startedAt(), session.endedAt(), session.activeDurationSeconds());
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(json(source).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private String json(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (JsonProcessingException invalid) {
            throw new IllegalStateException("Cannot encode summary read model", invalid);
        }
    }

    private record Source(long revision, long version, UUID lectureId, String title,
            java.util.List<ru.university.assistant.live.api.SessionGroup> groups, String status,
            java.time.Instant startedAt, java.time.Instant endedAt, long activeSeconds) {}
}
