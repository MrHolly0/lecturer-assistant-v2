package ru.university.assistant.live.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.IdentityLevel;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionParticipant;
import ru.university.assistant.live.api.SessionStatus;

@Repository
class LiveSessionRepository {
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    LiveSessionRepository(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    LiveSession create(UUID sessionId, UUID lectureId, UUID createdBy, String joinCode) {
        jdbc.sql(
                        """
                        insert into live.sessions (id, lecture_id, status, join_code, started_at, created_by)
                        values (:id, :lectureId, 'LIVE', :joinCode, now(), :createdBy)
                        """)
                .param("id", sessionId)
                .param("lectureId", lectureId)
                .param("joinCode", joinCode)
                .param("createdBy", createdBy)
                .update();
        return findById(sessionId).orElseThrow();
    }

    Optional<LiveSession> findById(UUID sessionId) {
        return jdbc.sql(
                        """
                        select s.id, l.course_id, s.lecture_id, l.deck_id, l.title as lecture_title, s.status,
                            s.join_code, s.current_slide_idx, s.annotations, s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where s.id = :sessionId
                        """)
                .param("sessionId", sessionId)
                .query(this::mapSession)
                .optional();
    }

    Optional<LiveSession> findByCourse(UUID courseId, UUID sessionId) {
        return jdbc.sql(
                        """
                        select s.id, l.course_id, s.lecture_id, l.deck_id, l.title as lecture_title, s.status,
                            s.join_code, s.current_slide_idx, s.annotations, s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId and s.id = :sessionId
                        """)
                .param("courseId", courseId)
                .param("sessionId", sessionId)
                .query(this::mapSession)
                .optional();
    }

    Optional<LiveSession> findByJoinCode(UUID courseId, String joinCode) {
        return jdbc.sql(
                        """
                        select s.id, l.course_id, s.lecture_id, l.deck_id, l.title as lecture_title, s.status,
                            s.join_code, s.current_slide_idx, s.annotations, s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId and s.join_code = :joinCode
                        """)
                .param("courseId", courseId)
                .param("joinCode", joinCode)
                .query(this::mapSession)
                .optional();
    }

    Optional<LiveSession> findByJoinCode(String joinCode) {
        return jdbc.sql(
                        """
                        select s.id, l.course_id, s.lecture_id, l.deck_id, l.title as lecture_title, s.status,
                            s.join_code, s.current_slide_idx, s.annotations, s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where s.join_code = :joinCode
                        """)
                .param("joinCode", joinCode)
                .query(this::mapSession)
                .optional();
    }

    boolean lectureBelongsToCourse(UUID courseId, UUID lectureId) {
        return jdbc.sql("select count(*) from live.lectures where course_id = :courseId and id = :lectureId")
                .param("courseId", courseId)
                .param("lectureId", lectureId)
                .query(Long.class)
                .single()
                > 0;
    }

    LiveSession updateSlide(UUID courseId, UUID sessionId, int slideIdx) {
        jdbc.sql(
                        """
                        update live.sessions
                        set current_slide_idx = :slideIdx, updated_at = now()
                        where id = :sessionId
                            and lecture_id in (select id from live.lectures where course_id = :courseId)
                        """)
                .param("courseId", courseId)
                .param("sessionId", sessionId)
                .param("slideIdx", slideIdx)
                .update();
        addSlideLog(sessionId, slideIdx);
        return findByCourse(courseId, sessionId).orElseThrow();
    }

    LiveSession updateAnnotations(UUID courseId, UUID sessionId, Map<String, Object> annotations) {
        jdbc.sql(
                        """
                        update live.sessions
                        set annotations = cast(:annotations as jsonb), updated_at = now()
                        where id = :sessionId
                            and lecture_id in (select id from live.lectures where course_id = :courseId)
                        """)
                .param("courseId", courseId)
                .param("sessionId", sessionId)
                .param("annotations", json(annotations))
                .update();
        return findByCourse(courseId, sessionId).orElseThrow();
    }

    LiveSession updateStatus(UUID courseId, UUID sessionId, SessionStatus status) {
        jdbc.sql(
                        """
                        update live.sessions
                        set status = :status,
                            ended_at = case when :status = 'ENDED' then now() else ended_at end,
                            updated_at = now()
                        where id = :sessionId
                            and lecture_id in (select id from live.lectures where course_id = :courseId)
                        """)
                .param("courseId", courseId)
                .param("sessionId", sessionId)
                .param("status", status.name())
                .update();
        return findByCourse(courseId, sessionId).orElseThrow();
    }

    void addSlideLog(UUID sessionId, int slideIdx) {
        jdbc.sql("insert into live.slide_log (id, session_id, slide_idx) values (:id, :sessionId, :slideIdx)")
                .param("id", ru.university.assistant.shared.api.UuidV7.generate())
                .param("sessionId", sessionId)
                .param("slideIdx", slideIdx)
                .update();
    }

    SessionParticipant join(UUID sessionId, AuthenticatedUser user) {
        return jdbc.sql(
                        """
                        insert into live.session_participants (session_id, person_id, channel_type, display_name)
                        values (:sessionId, :personId, 'web', :displayName)
                        on conflict (session_id, person_id, channel_type)
                        do update set left_at = null, kicked = false
                        returning session_id, person_id, channel_type, display_name, joined_at, left_at, kicked
                        """)
                .param("sessionId", sessionId)
                .param("personId", user.id())
                .param("displayName", user.displayName())
                .query(this::mapParticipant)
                .single();
    }

    SessionParticipant joinWeb(UUID sessionId, UUID personId, String displayName) {
        return jdbc.sql(
                        """
                        insert into live.session_participants (session_id, person_id, channel_type, display_name)
                        values (:sessionId, :personId, 'web', :displayName)
                        on conflict (session_id, person_id, channel_type)
                        do update set left_at = null, kicked = false
                        returning session_id, person_id, channel_type, display_name, joined_at, left_at, kicked
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("displayName", displayName)
                .query(this::mapParticipant)
                .single();
    }

    WebParticipant createWebToken(
            UUID id, UUID sessionId, UUID personId, String tokenHash, String displayName, IdentityLevel level) {
        jdbc.sql(
                        """
                        insert into live.web_participant_tokens
                            (id, session_id, person_id, token_hash, identity_level)
                        values (:id, :sessionId, :personId, :tokenHash, :level)
                        """)
                .param("id", id)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("tokenHash", tokenHash)
                .param("level", level.name())
                .update();
        return new WebParticipant(id, sessionId, personId, displayName, level);
    }

    Optional<WebParticipant> findWebParticipant(String tokenHash) {
        return jdbc.sql(
                        """
                        select t.id, t.session_id, t.person_id, p.display_name, t.identity_level
                        from live.web_participant_tokens t
                        join iam.persons p on p.id = t.person_id
                        where t.token_hash = :tokenHash
                        """)
                .param("tokenHash", tokenHash)
                .query(this::mapWebParticipant)
                .optional();
    }

    void touchWebParticipant(UUID participantId) {
        jdbc.sql("update live.web_participant_tokens set last_seen_at = now() where id = :participantId")
                .param("participantId", participantId)
                .update();
    }

    List<SessionParticipant> listParticipants(UUID sessionId) {
        return jdbc.sql(
                        """
                        select session_id, person_id, channel_type, display_name, joined_at, left_at, kicked
                        from live.session_participants
                        where session_id = :sessionId
                        order by left_at nulls first, joined_at desc
                        """)
                .param("sessionId", sessionId)
                .query(this::mapParticipant)
                .list();
    }

    private LiveSession mapSession(ResultSet rs, int rowNumber) throws SQLException {
        return new LiveSession(
                rs.getObject("id", UUID.class),
                rs.getObject("course_id", UUID.class),
                rs.getObject("lecture_id", UUID.class),
                rs.getObject("deck_id", UUID.class),
                rs.getString("lecture_title"),
                SessionStatus.valueOf(rs.getString("status")),
                rs.getString("join_code"),
                rs.getInt("current_slide_idx"),
                readMap(rs.getString("annotations")),
                rs.getTimestamp("started_at") == null ? null : rs.getTimestamp("started_at").toInstant(),
                rs.getTimestamp("ended_at") == null ? null : rs.getTimestamp("ended_at").toInstant());
    }

    private SessionParticipant mapParticipant(ResultSet rs, int rowNumber) throws SQLException {
        return new SessionParticipant(
                rs.getObject("session_id", UUID.class),
                rs.getObject("person_id", UUID.class),
                rs.getString("channel_type"),
                rs.getString("display_name"),
                rs.getTimestamp("joined_at").toInstant(),
                rs.getTimestamp("left_at") == null ? null : rs.getTimestamp("left_at").toInstant(),
                rs.getBoolean("kicked"));
    }

    private WebParticipant mapWebParticipant(ResultSet rs, int rowNumber) throws SQLException {
        return new WebParticipant(
                rs.getObject("id", UUID.class),
                rs.getObject("session_id", UUID.class),
                rs.getObject("person_id", UUID.class),
                rs.getString("display_name"),
                IdentityLevel.valueOf(rs.getString("identity_level")));
    }

    private Map<String, Object> readMap(String json) {
        try {
            return objectMapper.readValue(json == null ? "{}" : json, MAP_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot read session JSON", exception);
        }
    }

    private String json(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Cannot write session JSON", exception);
        }
    }
}
