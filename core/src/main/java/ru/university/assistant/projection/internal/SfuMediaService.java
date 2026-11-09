package ru.university.assistant.projection.internal;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AccountStateApi;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.live.api.MediaViewingAccessApi;
import ru.university.assistant.live.api.MediaViewingAccessApi.ViewerAccess;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.shared.api.UuidV7;

/** Durable media control. Video packets and SFU credentials never enter the application JVM. */
@Service
@ConditionalOnProperty(name = "app.media.provider", havingValue = "sfu")
public class SfuMediaService {
    private final JdbcClient jdbc;
    private final LiveSessionAccessApi sessions;
    private final CourseAccessApi courses;
    private final AccountStateApi accounts;
    private final MediaViewingAccessApi viewers;
    private final ProjectionService projection;

    SfuMediaService(JdbcClient jdbc, LiveSessionAccessApi sessions, CourseAccessApi courses,
            AccountStateApi accounts, MediaViewingAccessApi viewers, ProjectionService projection) {
        this.jdbc = jdbc; this.sessions = sessions; this.courses = courses;
        this.accounts = accounts; this.viewers = viewers; this.projection = projection;
    }

    @Transactional
    public Map<String, Object> start(AuthenticatedUser user, UUID course, UUID session, String source) {
        LiveSession live = manage(user, course, session);
        jdbc.sql("select pg_advisory_xact_lock(hashtextextended(:id, 1))")
                .param("id", "sfu-room-admission").query((rs, row) -> true).single();
        jdbc.sql("update projection.sfu_rooms set stopped = true where session_id = :id and lease_until <= now()")
                .param("id", session).update();
        if (jdbc.sql("select count(*) from projection.sfu_rooms where not stopped and lease_until > now()")
                .query(Integer.class).single() >= 128) throw error(503, "Лимит одновременных демонстраций");
        if (jdbc.sql("select exists(select 1 from projection.sfu_rooms where session_id = :id and not stopped)")
                .param("id", session).query(Boolean.class).single()) throw error(409, "Демонстрация уже идёт");
        UUID id = UuidV7.generate();
        jdbc.sql("""
                insert into projection.sfu_rooms(id, session_id, course_id, owner_id, owner_version,
                    source_name, lease_until) values (:id, :session, :course, :owner, :version, :source,
                        now() + interval '15 seconds')
                """).param("id", id).param("session", session).param("course", course)
                .param("owner", user.id()).param("version", accounts.find(user.id()).orElseThrow().version())
                .param("source", source).update();
        return status(room(id), live.status() == SessionStatus.PAUSED);
    }

    public void authorizeManagement(AuthenticatedUser user, UUID course, UUID session) {
        manage(user, course, session);
    }

    @Transactional
    public Map<String, Object> poll(AuthenticatedUser user, UUID course, UUID session, UUID id) {
        LiveSession live = manage(user, course, session);
        Room room = owned(user, session, id);
        jdbc.sql("update projection.sfu_rooms set lease_until = now() + interval '15 seconds' where id = :id")
                .param("id", id).update();
        jdbc.sql("update projection.sfu_grants set expires_at = now() + interval '2 minutes'"
                + " where room_id = :id and publisher and person_id = :owner")
                .param("id", id).param("owner", user.id()).update();
        return status(room(id), live.status() == SessionStatus.PAUSED);
    }

    @Transactional
    public void stop(AuthenticatedUser user, UUID course, UUID session, UUID id) {
        courses.requireManage(user, course);
        sessions.requireSessionInCourse(course, session);
        owned(user, session, id);
        jdbc.sql("update projection.sfu_rooms set stopped = true where id = :id").param("id", id).update();
    }

    @Transactional
    public UUID publisherGrant(AuthenticatedUser user, UUID course, UUID session, UUID id) {
        manage(user, course, session); Room room = owned(user, session, id);
        return grant(room, user.id(), accounts.find(user.id()).orElseThrow().version(), user.id(), true, false);
    }

    @Transactional
    public Map<String, Object> viewerGrant(ViewerAccess access, UUID viewer, boolean projector) {
        var room = jdbc.sql("select * from projection.sfu_rooms where session_id = :id and not stopped"
                        + " and lease_until > now()")
                .param("id", access.session().id()).query(this::map).optional();
        if (room.isEmpty()) return null;
        boolean paused = access.session().status() == SessionStatus.PAUSED;
        UUID grant = paused ? null : grant(room.get(), access.personId(), projector ? 0
                : accounts.find(access.personId()).orElseThrow().version(), viewer, false, projector);
        var result = new java.util.LinkedHashMap<>(status(room.get(), paused));
        result.put("grantId", grant);
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> authorize(List<UUID> ids, List<UUID> roomIds) {
        Instant expires = Instant.now().plusSeconds(5);
        List<Grant> grants = ids.isEmpty() ? List.of() : jdbc.sql("""
                select * from projection.sfu_grants where id in (:ids) and expires_at > now()
                """).param("ids", ids).query((rs, row) -> new Grant(rs.getObject("id", UUID.class),
                        rs.getObject("room_id", UUID.class), rs.getObject("person_id", UUID.class),
                        rs.getLong("auth_version"), rs.getBoolean("publisher"), rs.getBoolean("projector"))).list();
        Set<UUID> allRooms = new HashSet<>(roomIds);
        grants.forEach(grant -> allRooms.add(grant.room()));
        List<Map<String, Object>> validGrants = new ArrayList<>();
        Set<UUID> validRooms = new HashSet<>();
        Map<UUID, Long> versions = accounts.enabledVersions(grants.stream().filter(g -> !g.projector())
                .map(Grant::person).collect(Collectors.toSet()));
        for (UUID roomId : allRooms) {
            Room room;
            LiveSession live;
            try {
                room = room(roomId);
                live = sessions.requireSessionInCourse(room.course(), room.session());
                var owner = accounts.find(room.owner()).orElseThrow();
                if (owner.version() != room.ownerVersion() || !accounts.enabledVersions(Set.of(owner.id()))
                        .containsKey(owner.id())) continue;
                courses.requireManage(new AuthenticatedUser(owner.id(), owner.displayName(), owner.email(),
                        owner.role()), room.course());
                if (live.status() != SessionStatus.LIVE) continue;
            } catch (RuntimeException denied) { continue; }
            validRooms.add(roomId);
            List<Grant> members = grants.stream().filter(g -> g.room().equals(roomId)).toList();
            Set<UUID> students = viewers.allowedViewers(live.joinCode(), members.stream()
                    .filter(g -> !g.publisher() && !g.projector()).map(Grant::person).collect(Collectors.toSet()));
            for (Grant grant : members) {
                boolean allowed = grant.projector() ? projection.canReceiveSfu(grant.person(), room.session())
                        : Long.valueOf(grant.version()).equals(versions.get(grant.person()))
                            && (grant.publisher() ? grant.person().equals(room.owner())
                                : students.contains(grant.person()));
                if (allowed) validGrants.add(Map.of("id", grant.id(), "roomId", roomId,
                        "room", "lecture-" + roomId, "publisher", grant.publisher()));
            }
        }
        return Map.of("expiresAt", expires, "checkedAt", expires.minusSeconds(5),
                "grants", validGrants, "rooms", validRooms);
    }

    private UUID grant(Room room, UUID person, long version, UUID viewer, boolean publisher, boolean projector) {
        jdbc.sql("select pg_advisory_xact_lock(hashtextextended(:key, 2))")
                .param("key", room.id() + ":" + person).query((rs, row) -> true).single();
        if (!publisher) {
            int count = jdbc.sql("""
                    select count(*) from projection.sfu_grants where room_id = :room and person_id = :person
                        and expires_at > now() and viewer_id <> :viewer
                    """).param("room", room.id()).param("person", person).param("viewer", viewer)
                    .query(Integer.class).single();
            if (count >= 2) throw error(429, "Уже открыто два подключения демонстрации");
        }
        return jdbc.sql("""
                insert into projection.sfu_grants(id, room_id, person_id, auth_version, viewer_id,
                    publisher, projector, expires_at) values (:id, :room, :person, :version, :viewer,
                        :publisher, :projector, now() + interval '2 minutes')
                on conflict (room_id, person_id, viewer_id, publisher, projector) do update
                    set expires_at = excluded.expires_at, auth_version = excluded.auth_version returning id
                """).param("id", UuidV7.generate()).param("room", room.id()).param("person", person)
                .param("version", version).param("viewer", viewer).param("publisher", publisher)
                .param("projector", projector).query(UUID.class).single();
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 60000)
    public void retain() {
        jdbc.sql("delete from projection.sfu_grants where expires_at <= now()").update();
        jdbc.sql("delete from projection.sfu_rooms where created_at < now() - interval '1 day'"
                + " and (stopped or lease_until <= now())").update();
    }

    private LiveSession manage(AuthenticatedUser user, UUID course, UUID session) {
        courses.requireManage(user, course);
        LiveSession live = sessions.requireSessionInCourse(course, session);
        if (live.status() != SessionStatus.LIVE && live.status() != SessionStatus.PAUSED)
            throw error(409, "Занятие не идёт");
        return live;
    }

    private Room owned(AuthenticatedUser user, UUID session, UUID id) {
        Room room = room(id);
        if (!room.session().equals(session) || !room.owner().equals(user.id())) throw error(403, "Чужая демонстрация");
        return room;
    }

    private Room room(UUID id) {
        return jdbc.sql("select * from projection.sfu_rooms where id = :id and not stopped and lease_until > now()")
                .param("id", id).query(this::map).optional().orElseThrow(() -> error(410, "Демонстрация остановлена"));
    }

    private Room map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new Room(rs.getObject("id", UUID.class), rs.getObject("session_id", UUID.class),
                rs.getObject("course_id", UUID.class), rs.getObject("owner_id", UUID.class),
                rs.getLong("owner_version"), rs.getString("source_name"), rs.getTimestamp("lease_until").toInstant());
    }

    private Map<String, Object> status(Room room, boolean paused) {
        return Map.of("id", room.id(), "sourceName", room.source(), "leaseUntil", room.lease(),
                "paused", paused, "peers", List.of(), "iceServers", List.of(), "transport", "SFU");
    }

    private static ResponseStatusException error(int status, String message) {
        return new ResponseStatusException(HttpStatus.valueOf(status), message);
    }
    private record Room(UUID id, UUID session, UUID course, UUID owner, long ownerVersion,
            String source, Instant lease) {}
    private record Grant(UUID id, UUID room, UUID person, long version, boolean publisher, boolean projector) {}
}
