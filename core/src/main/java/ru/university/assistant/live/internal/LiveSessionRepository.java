package ru.university.assistant.live.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.IdentityLevel;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionGroup;
import ru.university.assistant.live.api.SessionParticipant;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.org.api.StudyGroup;

@Repository
class LiveSessionRepository {
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};
    private static final TypeReference<List<SessionGroup>> GROUP_LIST_TYPE = new TypeReference<>() {};

    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    LiveSessionRepository(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    LiveSession create(
            UUID sessionId, UUID lectureId, UUID createdBy, String joinCode, List<StudyGroup> groups) {
        jdbc.sql(
                        """
                        insert into live.sessions
                            (id, lecture_id, deck_id, status, join_code, created_by)
                        select :id, l.id, l.deck_id, 'SCHEDULED', :joinCode, :createdBy
                        from live.lectures l
                        where l.id = :lectureId
                        """)
                .param("id", sessionId)
                .param("lectureId", lectureId)
                .param("joinCode", joinCode)
                .param("createdBy", createdBy)
                .update();
        for (StudyGroup group : groups) {
            jdbc.sql(
                            """
                            insert into live.session_groups (session_id, group_id, group_name_snapshot)
                            values (:sessionId, :groupId, :groupName)
                            """)
                    .param("sessionId", sessionId)
                    .param("groupId", group.id())
                    .param("groupName", group.name())
                    .update();
        }
        return findById(sessionId).orElseThrow();
    }

    Optional<LiveSession> findById(UUID sessionId) {
        return jdbc.sql(
                        """
                        select s.id, l.course_id, s.lecture_id, s.deck_id, l.title as lecture_title,
                            coalesce((select jsonb_agg(jsonb_build_object(
                                    'id', sg.group_id, 'name', sg.group_name_snapshot)
                                        order by sg.group_name_snapshot, sg.group_id)
                                      from live.session_groups sg
                                      where sg.session_id = s.id), '[]'::jsonb)::text as groups,
                            s.status,
                            s.join_code, s.current_slide_idx, s.annotations, s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where s.id = :sessionId
                        """)
                .param("sessionId", sessionId)
                .query(this::mapSession)
                .optional()
                .map(this::withTiming);
    }

    Optional<LiveSession> findByCourse(UUID courseId, UUID sessionId) {
        return jdbc.sql(
                        """
                        select s.id, l.course_id, s.lecture_id, s.deck_id, l.title as lecture_title,
                            coalesce((select jsonb_agg(jsonb_build_object(
                                    'id', sg.group_id, 'name', sg.group_name_snapshot)
                                        order by sg.group_name_snapshot, sg.group_id)
                                      from live.session_groups sg
                                      where sg.session_id = s.id), '[]'::jsonb)::text as groups,
                            s.status,
                            s.join_code, s.current_slide_idx, s.annotations, s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId and s.id = :sessionId
                        """)
                .param("courseId", courseId)
                .param("sessionId", sessionId)
                .query(this::mapSession)
                .optional()
                .map(this::withTiming);
    }

    Optional<LiveSession> findByJoinCode(UUID courseId, String joinCode) {
        return jdbc.sql(
                        """
                        select s.id, l.course_id, s.lecture_id, s.deck_id, l.title as lecture_title,
                            coalesce((select jsonb_agg(jsonb_build_object(
                                    'id', sg.group_id, 'name', sg.group_name_snapshot)
                                        order by sg.group_name_snapshot, sg.group_id)
                                      from live.session_groups sg
                                      where sg.session_id = s.id), '[]'::jsonb)::text as groups,
                            s.status,
                            s.join_code, s.current_slide_idx, s.annotations, s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId and s.join_code = :joinCode
                        """)
                .param("courseId", courseId)
                .param("joinCode", joinCode)
                .query(this::mapSession)
                .optional()
                .map(this::withTiming);
    }

    Optional<LiveSession> findByJoinCode(String joinCode) {
        return jdbc.sql(
                        """
                        select s.id, l.course_id, s.lecture_id, s.deck_id, l.title as lecture_title,
                            coalesce((select jsonb_agg(jsonb_build_object(
                                    'id', sg.group_id, 'name', sg.group_name_snapshot)
                                        order by sg.group_name_snapshot, sg.group_id)
                                      from live.session_groups sg
                                      where sg.session_id = s.id), '[]'::jsonb)::text as groups,
                            s.status,
                            s.join_code, s.current_slide_idx, s.annotations, s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where s.join_code = :joinCode
                        """)
                .param("joinCode", joinCode)
                .query(this::mapSession)
                .optional()
                .map(this::withTiming);
    }

    /** B-03: самая свежая подготовленная или идущая лекция, созданная этим человеком. */
    Optional<LiveSession> findActiveForCreator(UUID personId) {
        return jdbc.sql(
                        """
                        select s.id, l.course_id, s.lecture_id, s.deck_id, l.title as lecture_title,
                            coalesce((select jsonb_agg(jsonb_build_object(
                                    'id', sg.group_id, 'name', sg.group_name_snapshot)
                                        order by sg.group_name_snapshot, sg.group_id)
                                      from live.session_groups sg
                                      where sg.session_id = s.id), '[]'::jsonb)::text as groups,
                            s.status,
                            s.join_code, s.current_slide_idx, s.annotations, s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where s.created_by = :personId and s.status in ('SCHEDULED', 'LIVE', 'PAUSED')
                        order by s.created_at desc
                        limit 1
                        """)
                .param("personId", personId)
                .query(this::mapSession)
                .optional()
                .map(this::withTiming);
    }

    Optional<UUID> lectureDeckId(UUID courseId, UUID lectureId) {
        return jdbc.sql("select deck_id from live.lectures where course_id = :courseId and id = :lectureId")
                .param("courseId", courseId)
                .param("lectureId", lectureId)
                .query(UUID.class)
                .optional();
    }

    String courseTitle(UUID courseId) {
        return jdbc.sql("select title from org.courses where id = :courseId")
                .param("courseId", courseId)
                .query(String.class)
                .single();
    }

    void lockDeckForSession(UUID deckId) {
        jdbc.sql("select id from content.slide_decks where id = :deckId for share")
                .param("deckId", deckId)
                .query(UUID.class)
                .single();
    }

    Optional<UUID> lockLectureAndGetDeck(UUID courseId, UUID lectureId) {
        return jdbc.sql("""
                        select deck_id from live.lectures
                        where course_id = :courseId and id = :lectureId
                        for share
                        """)
                .param("courseId", courseId)
                .param("lectureId", lectureId)
                .query(UUID.class)
                .optional();
    }

    boolean begin(UUID courseId, UUID sessionId) {
        return jdbc.sql(
                        """
                        update live.sessions
                        set status = 'LIVE', started_at = now(), updated_at = now()
                        where id = :sessionId and status = 'SCHEDULED'
                            and lecture_id in (select id from live.lectures where course_id = :courseId)
                        """)
                .param("courseId", courseId)
                .param("sessionId", sessionId)
                .update() == 1;
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
                        returning session_id, person_id, channel_type, display_name,
                                  group_id, group_name_snapshot, joined_at, left_at, kicked
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
                        returning session_id, person_id, channel_type, display_name,
                                  group_id, group_name_snapshot, joined_at, left_at, kicked
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("displayName", displayName)
                .query(this::mapParticipant)
                .single();
    }

    /** Регистрирует человека участником сессии; повторный вызов ничего не дублирует. */
    JoinOutcome joinPerson(UUID sessionId, UUID personId, String displayName, StudyGroup group) {
        return jdbc.sql(
                        """
                        insert into live.session_participants
                            (session_id, person_id, channel_type, display_name, group_id, group_name_snapshot)
                        values (:sessionId, :personId, 'web', :displayName, :groupId, :groupName)
                        on conflict (session_id, person_id, channel_type)
                        do update set left_at = null
                        returning (xmax = 0) as inserted, kicked
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("displayName", displayName)
                .param("groupId", group.id())
                .param("groupName", group.name())
                .query((rs, row) -> new JoinOutcome(rs.getBoolean("inserted"), rs.getBoolean("kicked")))
                .single();
    }

    /** Один PROFILE-токен на пару «сессия + человек»: новый вход заменяет прежний. */
    void deleteProfileTokens(UUID sessionId, UUID personId) {
        jdbc.sql(
                        """
                        delete from live.web_participant_tokens
                        where session_id = :sessionId and person_id = :personId and identity_level = 'PROFILE'
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .update();
    }

    record JoinOutcome(boolean inserted, boolean kicked) {}

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
                        select session_id, person_id, channel_type, display_name,
                               group_id, group_name_snapshot, joined_at, left_at, kicked
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
                readGroups(rs.getString("groups")),
                SessionStatus.valueOf(rs.getString("status")),
                rs.getString("join_code"),
                rs.getInt("current_slide_idx"),
                readMap(rs.getString("annotations")),
                rs.getTimestamp("started_at") == null ? null : rs.getTimestamp("started_at").toInstant(),
                rs.getTimestamp("ended_at") == null ? null : rs.getTimestamp("ended_at").toInstant(),
                Instant.EPOCH,
                0,
                0);
    }

    private LiveSession withTiming(LiveSession session) {
        Instant calculatedAt = Instant.now();
        if (session.startedAt() == null) {
            return withTiming(session, calculatedAt, 0, 0);
        }
        Instant effectiveEnd = session.endedAt() == null ? calculatedAt : session.endedAt();
        List<TimingEvent> timingEvents = timingEvents(session.id());
        long activeSeconds = activeSeconds(session.startedAt(), effectiveEnd, timingEvents);
        Instant slideStartedAt = latestSlideEnteredAt(session.id()).orElse(session.startedAt());
        long slideSeconds = activeSeconds(slideStartedAt, effectiveEnd, timingEvents);
        return withTiming(session, calculatedAt, activeSeconds, slideSeconds);
    }

    private LiveSession withTiming(
            LiveSession session, Instant calculatedAt, long activeSeconds, long slideSeconds) {
        return new LiveSession(
                session.id(),
                session.courseId(),
                session.lectureId(),
                session.deckId(),
                session.lectureTitle(),
                session.groups(),
                session.status(),
                session.joinCode(),
                session.currentSlideIdx(),
                session.annotations(),
                session.startedAt(),
                session.endedAt(),
                calculatedAt,
                activeSeconds,
                slideSeconds);
    }

    private List<TimingEvent> timingEvents(UUID sessionId) {
        return jdbc.sql(
                        """
                        select verb, occurred_at
                        from analytics.events
                        where aggregate_type = 'live.session' and aggregate_id = :sessionId
                            and verb in ('session.paused', 'session.resumed')
                        order by occurred_at, id
                        """)
                .param("sessionId", sessionId)
                .query((rs, row) -> new TimingEvent(rs.getString("verb"), rs.getTimestamp("occurred_at").toInstant()))
                .list();
    }

    private Optional<Instant> latestSlideEnteredAt(UUID sessionId) {
        return jdbc.sql(
                        """
                        select entered_at
                        from live.slide_log
                        where session_id = :sessionId
                        order by entered_at desc, id desc
                        limit 1
                        """)
                .param("sessionId", sessionId)
                .query((rs, row) -> rs.getTimestamp("entered_at").toInstant())
                .optional();
    }

    private long activeSeconds(Instant from, Instant until, List<TimingEvent> events) {
        if (!until.isAfter(from)) {
            return 0;
        }
        long totalMillis = Duration.between(from, until).toMillis();
        long pausedMillis = 0;
        Instant pausedAt = null;
        for (TimingEvent event : events) {
            if ("session.paused".equals(event.verb()) && pausedAt == null) {
                pausedAt = event.occurredAt();
            } else if ("session.resumed".equals(event.verb()) && pausedAt != null) {
                pausedMillis += overlapMillis(pausedAt, event.occurredAt(), from, until);
                pausedAt = null;
            }
        }
        if (pausedAt != null) {
            pausedMillis += overlapMillis(pausedAt, until, from, until);
        }
        return Math.max(0, totalMillis - pausedMillis) / 1000;
    }

    private long overlapMillis(Instant intervalStart, Instant intervalEnd, Instant from, Instant until) {
        Instant start = intervalStart.isAfter(from) ? intervalStart : from;
        Instant end = intervalEnd.isBefore(until) ? intervalEnd : until;
        return end.isAfter(start) ? Duration.between(start, end).toMillis() : 0;
    }

    private record TimingEvent(String verb, Instant occurredAt) {}

    private SessionParticipant mapParticipant(ResultSet rs, int rowNumber) throws SQLException {
        return new SessionParticipant(
                rs.getObject("session_id", UUID.class),
                rs.getObject("person_id", UUID.class),
                rs.getString("channel_type"),
                rs.getString("display_name"),
                rs.getObject("group_id", UUID.class),
                rs.getString("group_name_snapshot"),
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

    private List<SessionGroup> readGroups(String json) {
        try {
            return objectMapper.readValue(json == null ? "[]" : json, GROUP_LIST_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot read session groups", exception);
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
