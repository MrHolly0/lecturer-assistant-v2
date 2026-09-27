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
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
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

    Optional<String> findActiveJoinCodeForParticipant(UUID personId) {
        return jdbc.sql("""
                        select s.join_code
                        from live.session_participants sp
                        join live.sessions s on s.id = sp.session_id
                        where sp.person_id = :personId and sp.channel_type = 'web'
                            and sp.left_at is null and sp.kicked = false
                            and s.status in ('SCHEDULED', 'LIVE', 'PAUSED')
                        order by sp.joined_at desc, s.created_at desc
                        limit 1
                        """)
                .param("personId", personId)
                .query(String.class)
                .optional();
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

    int deckSlideCount(UUID deckId) {
        return jdbc.sql("select count(*) from content.slides where deck_id = :deckId")
                .param("deckId", deckId)
                .query(Integer.class)
                .single();
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
                                  group_id, group_name_snapshot, joined_at, left_at, kicked,
                                  name_requested_at, name_submitted_at
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
                                  group_id, group_name_snapshot, joined_at, left_at, kicked,
                                  name_requested_at, name_submitted_at
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("displayName", displayName)
                .query(this::mapParticipant)
                .single();
    }

    Optional<SessionParticipant> lockGuestParticipation(UUID sessionId, UUID personId) {
        return jdbc.sql("""
                        select session_id, person_id, channel_type, display_name,
                               group_id, group_name_snapshot, joined_at, left_at, kicked,
                               name_requested_at, name_submitted_at
                        from live.session_participants
                        where session_id = :sessionId and person_id = :personId
                            and channel_type = 'web'
                        for update
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .query(this::mapParticipant)
                .optional();
    }

    /** Bearer proof of the guest token promotes one lecture participation to the signed-in person. */
    void claimGuestParticipation(UUID sessionId, UUID guestId, UUID personId, String guestName) {
        jdbc.sql("""
                        update live.session_participants profile
                        set display_name = case when :guestName like 'Гость %'
                                                then profile.display_name else :guestName end,
                            joined_at = least(profile.joined_at, guest.joined_at),
                            name_requested_at = coalesce(guest.name_requested_at, profile.name_requested_at),
                            name_submitted_at = coalesce(guest.name_submitted_at, profile.name_submitted_at)
                        from live.session_participants guest
                        where profile.session_id = :sessionId and profile.person_id = :personId
                            and profile.channel_type = 'web'
                            and guest.session_id = :sessionId and guest.person_id = :guestId
                            and guest.channel_type = 'web'
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("guestId", guestId)
                .param("guestName", guestName)
                .update();

        jdbc.sql("""
                        delete from feedback.comprehension_signals guest
                        using feedback.comprehension_signals profile
                        where guest.person_id = :guestId and profile.person_id = :personId
                            and profile.session_id = guest.session_id and profile.slide_idx = guest.slide_idx
                        """)
                .param("guestId", guestId).param("personId", personId).update();
        jdbc.sql("update feedback.comprehension_signals set person_id = :personId where person_id = :guestId")
                .param("guestId", guestId).param("personId", personId).update();

        jdbc.sql("""
                        delete from interaction.poll_responses guest
                        using interaction.poll_responses profile
                        where guest.person_id = :guestId and profile.person_id = :personId
                            and profile.poll_id = guest.poll_id
                        """)
                .param("guestId", guestId).param("personId", personId).update();
        jdbc.sql("update interaction.poll_responses set person_id = :personId where person_id = :guestId")
                .param("guestId", guestId).param("personId", personId).update();

        jdbc.sql("""
                        delete from interaction.activity_responses guest
                        using interaction.activity_responses profile
                        where guest.person_id = :guestId and profile.person_id = :personId
                            and profile.run_id = guest.run_id and profile.question_id = guest.question_id
                        """)
                .param("guestId", guestId).param("personId", personId).update();
        jdbc.sql("update interaction.activity_responses set person_id = :personId where person_id = :guestId")
                .param("guestId", guestId).param("personId", personId).update();
        jdbc.sql("update qa.questions set person_id = :personId where person_id = :guestId")
                .param("guestId", guestId).param("personId", personId).update();
        jdbc.sql("update analytics.events set actor_person_id = :personId where actor_person_id = :guestId")
                .param("guestId", guestId).param("personId", personId).update();
        jdbc.sql("delete from live.web_participant_tokens where session_id = :sessionId and person_id = :guestId")
                .param("sessionId", sessionId).param("guestId", guestId).update();
        jdbc.sql("""
                        delete from live.session_participants
                        where session_id = :sessionId and person_id = :guestId and channel_type = 'web'
                        """)
                .param("sessionId", sessionId).param("guestId", guestId).update();
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

    boolean clearKickForRejoin(UUID sessionId, UUID personId) {
        return jdbc.sql("""
                        update live.session_participants
                        set kicked = false, left_at = null, joined_at = now(),
                            name_requested_at = null, name_submitted_at = null
                        where session_id = :sessionId and person_id = :personId
                            and channel_type = 'web' and kicked = true
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .update() == 1;
    }

    Optional<SessionParticipant> kickParticipant(UUID sessionId, UUID personId) {
        return jdbc.sql("""
                        update live.session_participants
                        set kicked = true, left_at = now(), name_requested_at = null
                        where session_id = :sessionId and person_id = :personId
                            and channel_type = 'web' and left_at is null and kicked = false
                        returning session_id, person_id, channel_type, display_name,
                                  group_id, group_name_snapshot, joined_at, left_at, kicked,
                                  name_requested_at, name_submitted_at
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .query(this::mapParticipant)
                .optional();
    }

    Optional<SessionParticipant> requestParticipantName(UUID sessionId, UUID personId) {
        return jdbc.sql("""
                        update live.session_participants
                        set name_requested_at = now(), name_submitted_at = null
                        where session_id = :sessionId and person_id = :personId
                            and channel_type = 'web' and left_at is null and kicked = false
                        returning session_id, person_id, channel_type, display_name,
                                  group_id, group_name_snapshot, joined_at, left_at, kicked,
                                  name_requested_at, name_submitted_at
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .query(this::mapParticipant)
                .optional();
    }

    Optional<SessionParticipant> submitParticipantName(UUID sessionId, UUID personId, String displayName) {
        return jdbc.sql("""
                        update live.session_participants
                        set display_name = :displayName, name_submitted_at = now()
                        where session_id = :sessionId and person_id = :personId
                            and channel_type = 'web' and left_at is null and kicked = false
                        returning session_id, person_id, channel_type, display_name,
                                  group_id, group_name_snapshot, joined_at, left_at, kicked,
                                  name_requested_at, name_submitted_at
                        """)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("displayName", displayName)
                .query(this::mapParticipant)
                .optional();
    }

    Optional<ParticipationState> participationState(UUID sessionId, UUID personId) {
        return participationStates(sessionId, Set.of(personId)).values().stream().findFirst();
    }

    Map<UUID, ParticipationState> participationStates(UUID sessionId, Set<UUID> personIds) {
        if (personIds.isEmpty()) return Map.of();
        return jdbc.sql("""
                        select person_id, kicked, left_at, name_requested_at, name_submitted_at
                        from live.session_participants
                        where session_id = :sessionId and person_id in (:personIds)
                            and channel_type = 'web'
                        """)
                .param("sessionId", sessionId)
                .param("personIds", personIds)
                .query((rs, row) -> new ParticipationState(
                        rs.getObject("person_id", UUID.class),
                        rs.getBoolean("kicked"),
                        rs.getTimestamp("left_at") != null,
                        rs.getTimestamp("name_requested_at") != null
                                && rs.getTimestamp("name_submitted_at") == null))
                .list().stream().collect(Collectors.toMap(ParticipationState::personId, state -> state));
    }

    record ParticipationState(UUID personId, boolean kicked, boolean left, boolean nameRequested) {
        boolean active() { return !kicked && !left; }
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
                        select t.id, t.session_id, t.person_id,
                               coalesce(sp.display_name, p.display_name) as display_name, t.identity_level
                        from live.web_participant_tokens t
                        join iam.persons p on p.id = t.person_id
                        left join live.session_participants sp on sp.session_id = t.session_id
                            and sp.person_id = t.person_id and sp.channel_type = 'web'
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
                               group_id, group_name_snapshot, joined_at, left_at, kicked,
                               name_requested_at, name_submitted_at
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
                rs.getBoolean("kicked"),
                rs.getTimestamp("name_requested_at") == null ? null : rs.getTimestamp("name_requested_at").toInstant(),
                rs.getTimestamp("name_submitted_at") == null ? null : rs.getTimestamp("name_submitted_at").toInstant());
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
