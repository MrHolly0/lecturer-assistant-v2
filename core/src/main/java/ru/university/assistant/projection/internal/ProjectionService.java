package ru.university.assistant.projection.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AccountStateApi;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.live.api.MediaViewingAccessApi.ViewerAccess;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.projection.api.ProjectionContracts;
import ru.university.assistant.projection.api.ProjectionContracts.Ack;
import ru.university.assistant.projection.api.ProjectionContracts.AgentPolicy;
import ru.university.assistant.projection.api.ProjectionContracts.Command;
import ru.university.assistant.projection.api.ProjectionContracts.CommandPayload;
import ru.university.assistant.projection.api.ProjectionContracts.CommandRequest;
import ru.university.assistant.projection.api.ProjectionContracts.CommandType;
import ru.university.assistant.projection.api.ProjectionContracts.Device;
import ru.university.assistant.projection.api.ProjectionContracts.DeviceStatus;
import ru.university.assistant.projection.api.ProjectionContracts.PairRequest;
import ru.university.assistant.projection.api.ProjectionContracts.PairedDevice;
import ru.university.assistant.projection.api.ProjectionContracts.Pairing;
import ru.university.assistant.projection.api.ProjectionContracts.Platform;
import ru.university.assistant.projection.api.ProjectionContracts.PolicyUpdate;
import ru.university.assistant.projection.api.ProjectionContracts.PollRequest;
import ru.university.assistant.projection.api.ProjectionContracts.PollResponse;
import ru.university.assistant.projection.api.ProjectionContracts.Screen;
import ru.university.assistant.projection.api.ProjectionContracts.Settings;
import ru.university.assistant.shared.api.UuidV7;

/** One installation policy, scoped helper credentials, and a short leased command channel. */
@Service
public class ProjectionService {
    private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int LEASE_SECONDS = 12;
    private final JdbcClient jdbc;
    private final Clock clock;
    private final ObjectMapper json;
    private final AccountStateApi accounts;
    private final CourseAccessApi courses;
    private final LiveSessionAccessApi sessions;
    private final ProjectionReleaseCatalog releases;
    private final SecureRandom random = new SecureRandom();
    private final byte[] viewTokenKey = new byte[32];

    public ProjectionService(JdbcClient jdbc, Clock clock, ObjectMapper json, AccountStateApi accounts,
            CourseAccessApi courses, LiveSessionAccessApi sessions, ProjectionReleaseCatalog releases) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.json = json;
        this.accounts = accounts;
        this.courses = courses;
        this.sessions = sessions;
        this.releases = releases;
        random.nextBytes(viewTokenKey);
    }

    @Transactional(readOnly = true)
    public Settings settings(AuthenticatedUser user) {
        requireStaff(user);
        return settings(user, policy(false));
    }

    @Transactional
    public Settings updatePolicy(AuthenticatedUser user, PolicyUpdate update) {
        requireStaff(user);
        if (user.role() != PersonRole.ADMIN) {
            throw denied("Настройка доступна администратору");
        }
        Policy previous = policy(true);
        if (previous.revision() != update.expectedRevision()) {
            throw conflict("Настройка уже изменена. Обновите страницу");
        }
        jdbc.sql("""
                update projection.policy set agent_allowed = ?, minimum_version = ?,
                    revision = revision + 1, updated_at = ?, updated_by = ? where singleton
                """)
                .params(update.agentAllowed(), update.minimumVersion(), timestamp(clock.instant()), user.id())
                .update();
        // Disable stops only projection, not the lesson. Device credentials remain usable for security updates.
        if (!update.agentAllowed()) {
            jdbc.sql("""
                    update projection.devices set active_course_id = null, active_session_id = null,
                        active_until = null, active_command_id = null
                    """).update();
            jdbc.sql("""
                    update projection.commands set acknowledged_at = ?, result = 'CANCELLED'
                    where acknowledged_at is null and type <> 'CHECK_UPDATE'
                    """).param(timestamp(clock.instant())).update();
        }
        return settings(user, policy(false));
    }

    @Transactional
    public Pairing createPairing(AuthenticatedUser user) {
        requireStaff(user);
        Policy policy = policy(true);
        requireAllowed(policy);
        Instant now = clock.instant();
        jdbc.sql("delete from projection.pairings where expires_at < ? or owner_id = ?")
                .params(timestamp(now), user.id()).update();
        UUID id = UuidV7.generate();
        String code = randomCode(12);
        Instant expires = now.plusSeconds(300);
        jdbc.sql("""
                insert into projection.pairings(id, owner_id, code_hash, policy_revision, expires_at)
                values (?, ?, ?, ?, ?)
                """).params(id, user.id(), hash(code), policy.revision(), timestamp(expires)).update();
        return new Pairing(id, code, expires);
    }

    @Transactional
    public PairedDevice pair(PairRequest request) {
        Policy policy = policy(true);
        requireAllowed(policy);
        PairingRow pairing = jdbc.sql("""
                select id, owner_id, policy_revision, expires_at, consumed_at from projection.pairings
                where code_hash = ? for update
                """).param(hash(request.pairingCode())).query((row, index) -> new PairingRow(
                        row.getObject("id", UUID.class), row.getObject("owner_id", UUID.class),
                        row.getLong("policy_revision"), instant(row, "expires_at"), instant(row, "consumed_at")))
                .optional().orElseThrow(() -> unauthorized("Код подключения недействителен"));
        Instant now = clock.instant();
        if (pairing.consumedAt() != null || !pairing.expiresAt().isAfter(now)
                || pairing.policyRevision() != policy.revision() || currentStaff(pairing.ownerId()) == null) {
            throw unauthorized("Код подключения недействителен");
        }
        UUID id = UuidV7.generate();
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = HexFormat.of().formatHex(bytes);
        jdbc.sql("""
                insert into projection.devices(id, owner_id, token_hash, name, platform, version,
                    os_version, protocol_version, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """).params(id, pairing.ownerId(), hash(token), request.name().trim(), request.platform().name(),
                        request.version(), request.osVersion(), request.protocolVersion(), timestamp(now)).update();
        jdbc.sql("update projection.pairings set consumed_at = ? where id = ?")
                .params(timestamp(now), pairing.id()).update();
        return new PairedDevice(id, token, 1);
    }

    @Transactional
    public void revoke(AuthenticatedUser user, UUID id) {
        requireStaff(user);
        policy(true);
        DeviceRow device = device(id);
        requireOwner(user, device);
        jdbc.sql("""
                update projection.devices set revoked_at = ?, active_course_id = null,
                    active_session_id = null, active_until = null, active_command_id = null where id = ?
                """).params(timestamp(clock.instant()), id).update();
    }

    @Transactional
    public Command command(AuthenticatedUser user, UUID courseId, UUID sessionId, CommandRequest request) {
        requireStaff(user);
        Policy policy = policy(true);
        courses.requireManage(user, courseId);
        LiveSession session = sessions.requireSessionInCourse(courseId, sessionId);
        DeviceRow device = device(request.deviceId());
        requireOwner(user, device);
        if (device.revokedAt() != null) {
            throw conflict("Подключение помощника отозвано");
        }
        var existing = jdbc.sql("select * from projection.commands where device_id = ? and request_id = ?")
                .params(device.id(), request.requestId()).query(this::commandRow).optional();
        if (existing.isPresent()) {
            CommandRow old = existing.get();
            if (old.type() != request.type() || !courseId.equals(old.courseId())
                    || !sessionId.equals(old.sessionId())
                    || !java.util.Objects.equals(old.targetScreenId(), request.targetScreenId())) {
                throw conflict("Идентификатор команды уже использован");
            }
            return wire(old, session);
        }
        if (request.type() != CommandType.STOP_PROJECTION && request.type() != CommandType.CHECK_UPDATE) {
            requireAllowed(policy);
            requireActive(session);
            if (device.lastSeenAt() == null || device.lastSeenAt().isBefore(clock.instant().minusSeconds(15))) {
                throw conflict("Помощник не подключён");
            }
            if (ProjectionVersion.older(device.version(), policy.minimumVersion())) {
                throw conflict("Сначала обновите помощник");
            }
            if (request.targetScreenId() == null || request.targetScreenId().isBlank()
                    || device.screens().stream().noneMatch(screen -> screen.id().equals(request.targetScreenId()))) {
                throw conflict("Выберите доступный экран");
            }
            if (request.type() == CommandType.START_PUBLIC_PROJECTION && !request.displayConfirmed()) {
                throw conflict("Подтвердите проверочный код на проекторе");
            }
            if (request.type() == CommandType.START_PUBLIC_PROJECTION) {
                requireConfirmedTest(device, courseId, sessionId, request);
            }
        }
        // Output intentions and update checks supersede only their own command lane.
        String lane = request.type() == CommandType.CHECK_UPDATE ? "type = 'CHECK_UPDATE'" : "type <> 'CHECK_UPDATE'";
        jdbc.sql("update projection.commands set acknowledged_at = ?, result = 'CANCELLED' "
                + "where device_id = ? and acknowledged_at is null and " + lane)
                .params(timestamp(clock.instant()), device.id()).update();
        Instant now = clock.instant();
        UUID id = UuidV7.generate();
        String testCode = request.type() == CommandType.TEST_TARGET ? randomCode(6) : null;
        jdbc.sql("""
                insert into projection.commands(id, device_id, request_id, type, course_id, session_id,
                    target_screen_id, screen_fingerprint, test_code, created_at, expires_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """).params(id, device.id(), request.requestId(), request.type().name(), courseId, sessionId,
                        request.targetScreenId(), fingerprint(device.screens()), testCode,
                        timestamp(now), timestamp(now.plusSeconds(60))).update();
        if (request.type() == CommandType.STOP_PROJECTION) {
            clearActive(device.id());
        }
        return wire(new CommandRow(id, request.type(), courseId, sessionId, request.targetScreenId(),
                fingerprint(device.screens()), testCode, now.plusSeconds(60)), session);
    }

    @Transactional
    public PollResponse poll(String authorization, PollRequest request) {
        Policy policy = policy(true);
        String token = bearer(authorization);
        DeviceRow device = jdbc.sql("select * from projection.devices where token_hash = ? for update")
                .param(hash(token)).query(this::deviceRow).optional()
                .orElseThrow(() -> unauthorized("Подключение помощника недействительно"));
        if (device.revokedAt() != null) {
            throw unauthorized("Подключение помощника отозвано");
        }
        Instant now = clock.instant();
        AuthenticatedUser owner = currentStaff(device.ownerId());
        boolean allowed = policy.agentAllowed() && owner != null;
        boolean updateRequired = ProjectionVersion.older(request.version(), policy.minimumVersion());
        boolean localStop = request.status() == DeviceStatus.IDLE
                && (device.status() == DeviceStatus.SHOWING || device.status() == DeviceStatus.TESTING
                || device.status() == DeviceStatus.PAUSED);
        jdbc.sql("""
                update projection.devices set version = ?, protocol_version = ?, status = ?, screens = ?::jsonb,
                    last_seen_at = ?, os_version = coalesce(nullif(?, ''), os_version) where id = ?
                """).params(request.version(), request.protocolVersion(), request.status().name(),
                        encodeScreens(request.screens()), timestamp(now), request.osVersion(), device.id()).update();
        if (request.ack() != null) {
            acknowledge(device.id(), request.ack(), now);
            if (request.ack().result() == ProjectionContracts.CommandResult.FAILED
                    && request.ack().commandId().equals(device.activeCommandId())) {
                clearActive(device.id());
            }
        }
        device = device(device.id());
        boolean hasLease = allowed && !localStop && device.activeSessionId() != null && device.activeUntil() != null
                && device.activeUntil().isAfter(now)
                && canShow(owner, device.activeCourseId(), device.activeSessionId())
                && activeFingerprint(device.activeCommandId()).equals(fingerprint(request.screens()));
        if (!hasLease) {
            if (device.activeCommandId() != null) {
                // A delayed unacknowledged start must not resurrect an output after its lease was lost.
                cancel(device.activeCommandId(), now);
            }
            clearActive(device.id());
        }
        List<CommandRow> pending = jdbc.sql("""
                select * from projection.commands where device_id = ? and acknowledged_at is null
                    and expires_at > ? order by created_at, id limit 1
                """).params(device.id(), timestamp(now)).query(this::commandRow).list();
        List<Command> outgoing = new ArrayList<>();
        for (CommandRow command : pending) {
            if (command.type() == CommandType.CHECK_UPDATE || command.type() == CommandType.STOP_PROJECTION) {
                outgoing.add(wire(command, null));
                continue;
            }
            if (!allowed || updateRequired || !canShow(owner, command.courseId(), command.sessionId())
                    || !command.screenFingerprint().equals(fingerprint(request.screens()))
                    || request.screens().stream().noneMatch(screen -> screen.id().equals(command.targetScreenId()))) {
                cancel(command.id(), now);
                continue;
            }
            LiveSession session = sessions.requireSessionInCourse(command.courseId(), command.sessionId());
            outgoing.add(wire(command, session));
            jdbc.sql("""
                    update projection.devices set active_course_id = ?, active_session_id = ?, active_command_id = ?
                    where id = ?
                    """).params(command.courseId(), command.sessionId(), command.id(), device.id()).update();
            hasLease = true;
        }
        Instant lease = hasLease ? now.plusSeconds(LEASE_SECONDS) : null;
        if (lease != null) {
            jdbc.sql("update projection.devices set active_until = ? where id = ?")
                    .params(timestamp(lease), device.id()).update();
        }
        // A minimum-version change never replaces a process mid-show. Revocation is a separate safe stop.
        boolean mustStop = !allowed || (!hasLease && request.status() != DeviceStatus.IDLE);
        return new PollResponse(1, 3000, lease, mustStop,
                new AgentPolicy(allowed, policy.minimumVersion()), updateRequired,
                releases.update(device.platform(), device.osVersion(), request.version(), policy.minimumVersion()),
                List.copyOf(outgoing));
    }

    /** Read-media only, scoped to an acknowledged/delivered public output and its current short lease. */
    @Transactional(readOnly = true)
    public ViewerAccess requireProjectionViewer(String joinCode, String token) {
        if (token == null || !token.matches("[a-f0-9]{64}")) {
            throw unauthorized("Требуется доступ к публичному показу");
        }
        Policy policy = policy(false);
        if (!policy.agentAllowed()) {
            throw denied("Разрешение на показ отозвано");
        }
        Instant now = clock.instant();
        var grant = jdbc.sql("""
                select d.* from projection.commands c join projection.devices d on d.id = c.device_id
                where c.view_token_hash = ? and c.type = 'START_PUBLIC_PROJECTION'
                    and c.view_token_expires_at > ? and d.active_command_id = c.id
                    and d.active_session_id = c.session_id and d.active_course_id = c.course_id
                    and d.active_until > ? and d.revoked_at is null
                """).params(hash(token), timestamp(now), timestamp(now)).query(this::deviceRow).optional()
                .orElseThrow(() -> unauthorized("Доступ к публичному показу истёк"));
        AuthenticatedUser owner = currentStaff(grant.ownerId());
        if (!canShow(owner, grant.activeCourseId(), grant.activeSessionId())) {
            throw denied("Разрешение на показ отозвано");
        }
        LiveSession session = sessions.requireSessionInCourse(grant.activeCourseId(), grant.activeSessionId());
        if (!session.joinCode().equals(joinCode)) {
            throw denied("Доступ выдан для другого занятия");
        }
        // A helper receives at most two media viewer connections, independently of its staff owner's identity.
        return new ViewerAccess(session, grant.id());
    }

    private void acknowledge(UUID deviceId, Ack ack, Instant now) {
        int changed = jdbc.sql("""
                update projection.commands set acknowledged_at = coalesce(acknowledged_at, ?),
                    result = coalesce(result, ?) where id = ? and device_id = ?
                """).params(timestamp(now), ack.result().name(), ack.commandId(), deviceId).update();
        if (changed == 0) {
            throw conflict("Команда не принадлежит этому помощнику");
        }
        jdbc.sql("update projection.devices set diagnostic_code = ? where id = ?")
                .params(ack.diagnosticCode(), deviceId).update();
    }

    private void requireConfirmedTest(DeviceRow device, UUID courseId, UUID sessionId, CommandRequest request) {
        boolean confirmed = jdbc.sql("""
                select exists(select 1 from projection.commands where device_id = ? and course_id = ?
                    and session_id = ? and type = 'TEST_TARGET' and target_screen_id = ?
                    and screen_fingerprint = ? and test_code = ? and result = 'COMPLETED'
                    and created_at > ?)
                """).params(device.id(), courseId, sessionId, request.targetScreenId(),
                        fingerprint(device.screens()), request.testCode(),
                        timestamp(clock.instant().minusSeconds(600))).query(Boolean.class).single();
        if (!confirmed) {
            throw conflict("Повторите проверку экрана и введите показанный код");
        }
    }

    private String activeFingerprint(UUID commandId) {
        if (commandId == null) {
            return "";
        }
        return jdbc.sql("select screen_fingerprint from projection.commands where id = ?")
                .param(commandId).query(String.class).optional().orElse("");
    }

    private String fingerprint(List<Screen> screens) {
        return hash(encodeScreens(screens.stream().sorted(java.util.Comparator.comparing(Screen::id)).toList()));
    }

    private boolean canShow(AuthenticatedUser user, UUID courseId, UUID sessionId) {
        if (user == null || courseId == null || sessionId == null) {
            return false;
        }
        try {
            courses.requireManage(user, courseId);
            requireActive(sessions.requireSessionInCourse(courseId, sessionId));
            return true;
        } catch (ResponseStatusException rejected) {
            return false;
        }
    }

    private void clearActive(UUID deviceId) {
        jdbc.sql("""
                update projection.devices set active_course_id = null, active_session_id = null,
                    active_until = null, active_command_id = null where id = ?
                """).param(deviceId).update();
    }

    private void cancel(UUID commandId, Instant now) {
        jdbc.sql("update projection.commands set acknowledged_at = ?, result = 'CANCELLED' where id = ?")
                .params(timestamp(now), commandId).update();
    }

    private Settings settings(AuthenticatedUser user, Policy policy) {
        List<Device> devices = jdbc.sql("select * from projection.devices where owner_id = ? order by created_at desc")
                .param(user.id()).query(this::deviceRow).list().stream().map(device -> new Device(
                        device.id(), device.name(), device.platform(), device.version(), device.osVersion(),
                        device.status(), device.lastSeenAt(), device.revokedAt() == null && device.lastSeenAt() != null
                        && device.lastSeenAt().isAfter(clock.instant().minusSeconds(15)), device.revokedAt() != null,
                        ProjectionVersion.older(device.version(), policy.minimumVersion()), device.screens(),
                        device.diagnosticCode())).toList();
        return new Settings(policy.agentAllowed(), policy.minimumVersion(),
                releases.latestVersion(policy.minimumVersion()),
                policy.revision(), policy.updatedAt(),
                policy.agentAllowed() ? releases.installers(policy.minimumVersion()) : List.of(), devices);
    }

    private Policy policy(boolean lock) {
        return jdbc.sql("select * from projection.policy where singleton" + (lock ? " for update" : ""))
                .query((row, index) -> new Policy(row.getBoolean("agent_allowed"), row.getString("minimum_version"),
                        row.getLong("revision"), instant(row, "updated_at"))).single();
    }

    private DeviceRow device(UUID id) {
        return jdbc.sql("select * from projection.devices where id = ? for update").param(id)
                .query(this::deviceRow).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Помощник не найден"));
    }

    private DeviceRow deviceRow(ResultSet row, int index) throws SQLException {
        return new DeviceRow(row.getObject("id", UUID.class), row.getObject("owner_id", UUID.class),
                row.getString("name"), Platform.valueOf(row.getString("platform")), row.getString("version"),
                row.getString("os_version"), DeviceStatus.valueOf(row.getString("status")),
                instant(row, "last_seen_at"), instant(row, "revoked_at"), decodeScreens(row.getString("screens")),
                row.getObject("active_course_id", UUID.class), row.getObject("active_session_id", UUID.class),
                instant(row, "active_until"), row.getObject("active_command_id", UUID.class),
                row.getString("diagnostic_code"));
    }

    private CommandRow commandRow(ResultSet row, int index) throws SQLException {
        return new CommandRow(row.getObject("id", UUID.class), CommandType.valueOf(row.getString("type")),
                row.getObject("course_id", UUID.class), row.getObject("session_id", UUID.class),
                row.getString("target_screen_id"), row.getString("screen_fingerprint"), row.getString("test_code"),
                instant(row, "expires_at"));
    }

    private Command wire(CommandRow row, LiveSession session) {
        return new Command(row.id(), row.type(), row.expiresAt(), new CommandPayload(
                row.type() == CommandType.START_PUBLIC_PROJECTION && session != null ? session.joinCode() : null,
                row.targetScreenId(), row.testCode(),
                row.type() == CommandType.START_PUBLIC_PROJECTION ? projectionViewToken(row.id()) : null));
    }

    private String projectionViewToken(UUID commandId) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(viewTokenKey, "HmacSHA256"));
            String token = HexFormat.of().formatHex(mac.doFinal(
                    ("projection-view-v1:" + commandId).getBytes(StandardCharsets.UTF_8)));
            jdbc.sql("""
                    update projection.commands set view_token_hash = ?,
                        view_token_expires_at = created_at + interval '8 hours' where id = ?
                    """).params(hash(token), commandId).update();
            return token;
        } catch (java.security.GeneralSecurityException exception) {
            throw new IllegalStateException("Cannot issue projection viewer grant", exception);
        }
    }

    private AuthenticatedUser currentStaff(UUID id) {
        return accounts.find(id).filter(state -> state.status() == PersonStatus.ACTIVE
                        && state.role() != PersonRole.STUDENT)
                .map(state -> new AuthenticatedUser(state.id(), state.displayName(), state.email(), state.role()))
                .orElse(null);
    }

    private void requireStaff(AuthenticatedUser user) {
        if (user == null || user.role() == PersonRole.STUDENT) {
            throw denied("Настройка проектора доступна сотруднику");
        }
    }

    private void requireOwner(AuthenticatedUser user, DeviceRow device) {
        if (!device.ownerId().equals(user.id())) {
            throw denied("Это подключение другого пользователя");
        }
    }

    private void requireAllowed(Policy policy) {
        if (!policy.agentAllowed()) {
            throw denied("Помощник проектора отключён администратором. Доступен показ через браузер");
        }
    }

    private void requireActive(LiveSession session) {
        if (session.status() != SessionStatus.LIVE && session.status() != SessionStatus.PAUSED) {
            throw conflict("Занятие сейчас не идёт");
        }
    }

    private String encodeScreens(List<Screen> screens) {
        if (screens.stream().map(Screen::id).distinct().count() != screens.size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Повторный идентификатор экрана");
        }
        try {
            return json.writeValueAsString(screens);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot encode helper screens", exception);
        }
    }

    private List<Screen> decodeScreens(String value) {
        try {
            return json.readValue(value, new TypeReference<List<Screen>>() {});
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot decode helper screens", exception);
        }
    }

    private String randomCode(int length) {
        StringBuilder code = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            code.append(CODE_ALPHABET.charAt(random.nextInt(CODE_ALPHABET.length())));
        }
        return code.toString();
    }

    private String bearer(String authorization) {
        if (authorization == null || !authorization.matches("Bearer [a-f0-9]{64}")) {
            throw unauthorized("Требуется ключ помощника");
        }
        return authorization.substring(7);
    }

    private String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static OffsetDateTime timestamp(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static Instant instant(ResultSet row, String field) throws SQLException {
        OffsetDateTime value = row.getObject(field, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static ResponseStatusException denied(String reason) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, reason);
    }

    private static ResponseStatusException unauthorized(String reason) {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, reason);
    }

    private static ResponseStatusException conflict(String reason) {
        return new ResponseStatusException(HttpStatus.CONFLICT, reason);
    }

    private record Policy(boolean agentAllowed, String minimumVersion, long revision, Instant updatedAt) {}
    private record PairingRow(UUID id, UUID ownerId, long policyRevision, Instant expiresAt, Instant consumedAt) {}
    private record CommandRow(UUID id, CommandType type, UUID courseId, UUID sessionId,
            String targetScreenId, String screenFingerprint, String testCode, Instant expiresAt) {}
    private record DeviceRow(UUID id, UUID ownerId, String name, Platform platform, String version,
            String osVersion, DeviceStatus status, Instant lastSeenAt, Instant revokedAt, List<Screen> screens,
            UUID activeCourseId, UUID activeSessionId, Instant activeUntil, UUID activeCommandId,
            String diagnosticCode) {}
}
