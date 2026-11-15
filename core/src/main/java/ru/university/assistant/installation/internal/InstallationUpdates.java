package ru.university.assistant.installation.internal;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.shared.api.InstallationGate;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class InstallationUpdates implements InstallationGate {
    private static final String LEASE = "now()+interval '15 minutes'";
    private final JdbcClient jdbc;
    private final ReleaseCatalog catalogs;
    private final boolean enabled;

    InstallationUpdates(JdbcClient jdbc, ReleaseCatalog catalogs,
            @Value("${app.installation.enabled:false}") boolean enabled) {
        this.jdbc = jdbc;
        this.catalogs = catalogs;
        this.enabled = enabled;
    }

    @Override
    public void requireSessionAdmission() {
        // A configuration change must not bypass a persisted barrier after an uncertain apply.
        jdbc.sql("select pg_advisory_xact_lock_shared(14713,2530)").query().listOfRows();
        if (jdbc.sql("select exists(select 1 from installation.jobs where "
                + "(status='RUNNING' and (maintenance_until>now() or stage in ('APPLYING','VERIFYING'))) "
                + "or (status='NEEDS_ATTENTION' and maintenance_until is not null))")
                .query(Boolean.class).single()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Установка обновляется. Новое занятие можно будет начать после завершения обновления");
        }
    }

    public Status status(AuthenticatedUser actor) {
        admin(actor);
        var state = jdbc.sql("select * from installation.state where singleton").query().singleRow();
        List<JsonNode> releases = List.of();
        String catalogError = null;
        if (state.get("catalog_payload") instanceof String payload) {
            try {
                releases = java.util.stream.StreamSupport.stream(catalogs.verify(payload,
                        (String) state.get("catalog_signature")).path("releases").spliterator(), false).toList();
            } catch (ResponseStatusException invalid) { catalogError = invalid.getReason(); }
        }
        return new Status(enabled, schemaVersion(), time(state.get("operator_seen_at")),
                (String) state.get("operator_kind"), time(state.get("catalog_synced_at")), catalogError,
                releases, jdbc.sql("select * from installation.jobs order by created_at desc limit 20")
                        .query(this::job).list(), activeLessons());
    }

    @Transactional
    public Job request(AuthenticatedUser actor, String releaseId, String key) {
        admin(actor);
        requireEnabled();
        if (key == null || !key.matches("[a-zA-Z0-9._:-]{8,80}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Нужен ключ повторного запроса");
        }
        lockJobs();
        var previous = jdbc.sql("select * from installation.jobs where idempotency_key=:key")
                .param("key", key).query(this::job).optional();
        if (previous.isPresent()) {
            if (!previous.get().releaseId().equals(releaseId)) {
                throw conflict("Ключ уже использован для другого релиза");
            }
            return previous.get();
        }
        if (jdbc.sql("select exists(select 1 from installation.jobs "
                + "where status in ('QUEUED','RUNNING','NEEDS_ATTENTION'))").query(Boolean.class).single()) {
            throw conflict("Другое обновление ещё не завершено или требует внимания");
        }
        var state = jdbc.sql("select * from installation.state where singleton").query().singleRow();
        Instant seen = time(state.get("operator_seen_at"));
        if (seen == null || seen.isBefore(Instant.now().minusSeconds(90))) {
            throw conflict("Оператор установки не на связи");
        }
        String payload = (String) state.get("catalog_payload");
        String signature = (String) state.get("catalog_signature");
        compatible(catalogs.release(payload, signature, releaseId));
        UUID id = UuidV7.generate();
        jdbc.sql("insert into installation.jobs(id,release_id,requested_by,idempotency_key,"
                + "catalog_payload,catalog_signature) values(:id,:release,:person,:key,:payload,:signature)")
                .param("id", id).param("release", releaseId).param("person", actor.id()).param("key", key)
                .param("payload", payload).param("signature", signature).update();
        audit(id, "QUEUED", "Обновление запрошено администратором");
        return find(id);
    }

    @Transactional
    public void cancel(AuthenticatedUser actor, UUID id) {
        admin(actor);
        lockJobs();
        int count = jdbc.sql("update installation.jobs set status='CANCELLED',stage='CANCELLED',updated_at=now() "
                + "where id=:id and (status='QUEUED' or (status='RUNNING' and stage in ('CLAIMED','WAITING'))) ")
                .param("id", id).update();
        if (count == 0) throw conflict("Установка уже началась. Прерывать её из интерфейса нельзя");
        audit(id, "CANCELLED", "Запрос отменён администратором");
    }

    @Transactional
    public void acknowledge(AuthenticatedUser actor, UUID id) {
        admin(actor);
        lockJobs();
        int count = jdbc.sql("update installation.jobs set status='FAILED',maintenance_until=null,updated_at=now() "
                + "where id=:id and status='NEEDS_ATTENTION'").param("id", id).update();
        if (count == 0) throw conflict("Задание не требует ручного подтверждения");
        audit(id, "ACKNOWLEDGED", "Администратор подтвердил ручную проверку установки");
    }

    public void sync(String kind, SignedCatalog catalog) {
        requireEnabled();
        if (!kind.matches("compose|kubernetes")) throw conflict("Неизвестный тип оператора");
        catalogs.verify(catalog.payload(), catalog.signature());
        jdbc.sql("update installation.state set catalog_payload=:payload,catalog_signature=:signature,"
                + "catalog_synced_at=now(),operator_seen_at=now(),operator_kind=:kind where singleton")
                .param("payload", catalog.payload()).param("signature", catalog.signature())
                .param("kind", kind).update();
    }

    @Transactional
    public Assignment claim(UUID owner) {
        requireEnabled();
        lockJobs();
        jdbc.sql("update installation.state set operator_seen_at=now() where singleton").update();
        var expired = jdbc.sql("update installation.jobs set status='NEEDS_ATTENTION',"
                + "summary='Оператор потерял связь. Проверьте фактическое состояние установки',updated_at=now() "
                + "where status='RUNNING' and lease_until<now() returning id").query(UUID.class).list();
        expired.forEach(id -> audit(id, "NEEDS_ATTENTION", "Истекла аренда оператора"));
        var own = jdbc.sql("select * from installation.jobs where status='RUNNING' and owner=:owner")
                .param("owner", owner).query(this::job).optional();
        Job next = own.orElseGet(() -> {
            var queued = jdbc.sql("select * from installation.jobs where status='QUEUED' order by created_at limit 1")
                    .query(this::job).optional();
            if (queued.isEmpty()) return null;
            jdbc.sql("update installation.jobs set status='RUNNING',stage='CLAIMED',owner=:owner,"
                    + "fence=fence+1,lease_until=" + LEASE + ",updated_at=now() where id=:id")
                    .param("owner", owner).param("id", queued.get().id()).update();
            audit(queued.get().id(), "CLAIMED", "Оператор принял задание");
            return find(queued.get().id());
        });
        if (next == null) return null;
        var envelope = jdbc.sql("select catalog_payload,catalog_signature from installation.jobs where id=:id")
                .param("id", next.id()).query().singleRow();
        return new Assignment(next, new SignedCatalog((String) envelope.get("catalog_payload"),
                (String) envelope.get("catalog_signature")));
    }

    @Transactional
    public Job prepare(UUID id, UUID owner, long fence) {
        lockJobs();
        requireOwner(id, owner, fence);
        jdbc.sql("select pg_advisory_xact_lock(14713,2530)").query().listOfRows();
        Job current = find(id);
        if (current.stage().equals("BACKING_UP")) return current;
        if (!List.of("CLAIMED", "WAITING").contains(current.stage())) throw conflict("Неверный этап обновления");
        var envelope = jdbc.sql("select catalog_payload,catalog_signature from installation.jobs where id=:id")
                .param("id", id).query().singleRow();
        compatible(catalogs.release((String) envelope.get("catalog_payload"),
                (String) envelope.get("catalog_signature"), current.releaseId()));
        boolean ready = activeLessons() == 0;
        jdbc.sql("update installation.jobs set stage=:stage,maintenance_until="
                + (ready ? LEASE : "null") + ",updated_at=now() where id=:id")
                .param("stage", ready ? "BACKING_UP" : "WAITING").param("id", id).update();
        if (ready || !current.stage().equals("WAITING")) {
            audit(id, ready ? "BACKING_UP" : "WAITING", ready
                    ? "Новые занятия временно запрещены. Создаётся резервная копия"
                    : "Ожидаем завершения текущих занятий");
        }
        return find(id);
    }

    @Transactional
    public void heartbeat(UUID id, UUID owner, long fence) {
        requireOwner(id, owner, fence);
        jdbc.sql("update installation.jobs set lease_until=" + LEASE + ",maintenance_until="
                + "case when maintenance_until is null then null else " + LEASE + " end where id=:id")
                .param("id", id).update();
        jdbc.sql("update installation.state set operator_seen_at=now() where singleton").update();
    }

    @Transactional
    public Job progress(UUID id, UUID owner, long fence, String stage, String summary) {
        lockJobs();
        Job current = find(id);
        if (owner.equals(current.owner()) && fence == current.fence() && stage.equals(current.stage())) return current;
        requireOwner(id, owner, fence);
        boolean failure = stage.equals("FAILED") || stage.equals("NEEDS_ATTENTION");
        String expected = Map.of("BACKING_UP", "APPLYING", "APPLYING", "VERIFYING", "VERIFYING", "SUCCEEDED")
                .get(current.stage());
        if (!failure && !stage.equals(expected)) throw conflict("Этап обновления не соответствует текущему");
        if (stage.equals("FAILED") && List.of("APPLYING", "VERIFYING").contains(current.stage())) {
            stage = "NEEDS_ATTENTION";
        }
        String status = stage.equals("SUCCEEDED") ? "SUCCEEDED" : failure ? stage : "RUNNING";
        String message = summary == null ? "" : summary.replaceAll("[\\p{Cntrl}]", " ");
        if (message.length() > 500) message = message.substring(0, 500);
        jdbc.sql("update installation.jobs set stage=:stage,status=:status,summary=:summary,updated_at=now(),"
                + "maintenance_until=case when :status in ('SUCCEEDED','FAILED') then null else maintenance_until end "
                + "where id=:id").param("stage", stage).param("status", status).param("summary", message)
                .param("id", id).update();
        audit(id, stage, message);
        return find(id);
    }

    private void requireOwner(UUID id, UUID owner, long fence) {
        requireEnabled();
        if (!jdbc.sql("select exists(select 1 from installation.jobs where id=:id and owner=:owner "
                + "and fence=:fence and status='RUNNING' and lease_until>now() for update)")
                .param("id", id).param("owner", owner).param("fence", fence).query(Boolean.class).single()) {
            throw conflict("Аренда оператора устарела. Требуется проверка установки");
        }
    }

    private void compatible(JsonNode release) {
        long version = schemaVersion();
        if (version < release.path("databaseMin").asLong() || version > release.path("databaseMax").asLong()) {
            throw conflict("Версия базы данных не входит в диапазон совместимости этого релиза");
        }
    }
    private void lockJobs() { jdbc.sql("select pg_advisory_xact_lock(14713,2531)").query().listOfRows(); }
    private long activeLessons() {
        return jdbc.sql("select count(*) from live.sessions where status in ('SCHEDULED','LIVE','PAUSED')")
                .query(Long.class).single();
    }
    private long schemaVersion() {
        String version = jdbc.sql("select version from shared.flyway_schema_history where success "
                + "and version is not null order by installed_rank desc limit 1").query(String.class).single();
        try { return Long.parseLong(version); }
        catch (NumberFormatException unsupported) {
            throw conflict("Схема базы требует ручной проверки совместимости");
        }
    }
    private Job find(UUID id) {
        return jdbc.sql("select * from installation.jobs where id=:id").param("id", id).query(this::job).single();
    }
    private void audit(UUID id, String stage, String summary) {
        jdbc.sql("insert into installation.audit(job_id,stage,summary) values(:id,:stage,:summary)")
                .param("id", id).param("stage", stage).param("summary", summary).update();
    }
    private void admin(AuthenticatedUser actor) {
        if (actor == null || actor.role() != PersonRole.ADMIN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Только администратор управляет обновлениями");
        }
    }
    private void requireEnabled() {
        if (!enabled) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Управляемые обновления не включены");
    }
    private static ResponseStatusException conflict(String reason) {
        return new ResponseStatusException(HttpStatus.CONFLICT, reason);
    }
    private static Instant time(Object value) { return value == null ? null : ((Timestamp) value).toInstant(); }
    private Job job(ResultSet rs, int row) throws SQLException {
        return new Job(rs.getObject("id", UUID.class), rs.getString("release_id"), rs.getString("status"),
                rs.getString("stage"), rs.getString("summary"), rs.getLong("fence"), rs.getObject("owner", UUID.class),
                time(rs.getTimestamp("lease_until")), time(rs.getTimestamp("maintenance_until")),
                time(rs.getTimestamp("created_at")), time(rs.getTimestamp("updated_at")));
    }
    public record SignedCatalog(String payload, String signature) {}
    public record Assignment(Job job, SignedCatalog catalog) {}
    public record Job(UUID id, String releaseId, String status, String stage, String summary, long fence,
            UUID owner, Instant leaseUntil, Instant maintenanceUntil, Instant createdAt, Instant updatedAt) {}
    public record Status(boolean enabled, long databaseVersion, Instant operatorSeenAt, String operatorKind,
            Instant catalogSyncedAt, String catalogError, List<JsonNode> releases,
            List<Job> jobs, long activeLessons) {}
}
