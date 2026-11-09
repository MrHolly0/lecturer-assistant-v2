package ru.university.assistant.qa.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.qa.api.QuestionAnswerAudience;
import ru.university.assistant.qa.api.QuestionAnswerVisibility;
import ru.university.assistant.qa.api.QuestionCounts;
import ru.university.assistant.qa.api.QuestionPage;
import ru.university.assistant.qa.api.QuestionStatus;
import ru.university.assistant.qa.api.StudentQuestion;
import ru.university.assistant.qa.api.StudentQuestionAnswer;

@Repository
class QuestionRepository {
    private final JdbcClient jdbc;

    QuestionRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    java.util.Set<UUID> mutedAuthors(UUID sessionId, java.util.Set<UUID> persons) {
        if (persons.isEmpty()) return java.util.Set.of();
        return new java.util.HashSet<>(jdbc.sql("""
                select person_id from qa.author_mutes where session_id = :session and person_id in (:persons)
                """).param("session", sessionId).param("persons", persons).query(UUID.class).list());
    }

    boolean setAuthorMuted(UUID sessionId, UUID personId, boolean muted) {
        String sql = muted ? """
                insert into qa.author_mutes(session_id, person_id) values (:session, :person)
                on conflict (session_id, person_id) do nothing
                """ : "delete from qa.author_mutes where session_id = :session and person_id = :person";
        return jdbc.sql(sql).param("session", sessionId).param("person", personId).update() > 0;
    }

    void transferAuthorMute(UUID sessionId, UUID guestId, UUID personId) {
        jdbc.sql("""
                insert into qa.author_mutes(session_id, person_id, muted_at)
                select session_id, :person, muted_at from qa.author_mutes
                where session_id = :session and person_id = :guest
                on conflict (session_id, person_id) do nothing
                """).param("session", sessionId).param("person", personId).param("guest", guestId).update();
        jdbc.sql("delete from qa.author_mutes where session_id = :session and person_id = :guest")
                .param("session", sessionId).param("guest", guestId).update();
    }

    HiddenQuestions hideAuthorQuestions(UUID sessionId, UUID personId) {
        return jdbc.sql("""
                with previous as materialized (
                    select * from qa.questions
                    where session_id = :session and person_id = :person and status <> 'DISMISSED'
                    for update
                ), hidden as (
                    update qa.questions set status = 'DISMISSED', answer_text = null,
                        answer_visibility = null, answered_at = now()
                    where id in (select id from previous)
                    returning id
                )
                select (select count(*)::int from hidden) as count,
                    coalesce(jsonb_agg(to_jsonb(previous)), '[]'::jsonb)::text as snapshots from previous
                """).param("session", sessionId).param("person", personId)
                .query((rs, row) -> new HiddenQuestions(rs.getInt("count"), rs.getString("snapshots"))).single();
    }

    void logModeration(UUID sessionId, UUID questionId, UUID actor, boolean muted, HiddenQuestions hidden) {
        jdbc.sql("""
                insert into qa.author_moderation_log
                    (id, session_id, question_id, actor_person_id, muted, hidden_questions)
                values (:id, :session, :question, :actor, :muted, cast(:snapshots as jsonb))
                """).param("id", ru.university.assistant.shared.api.UuidV7.generate())
                .param("session", sessionId).param("question", questionId).param("actor", actor)
                .param("muted", muted).param("snapshots", hidden.snapshots()).update();
    }

    record HiddenQuestions(int count, String snapshots) {}

    StudentQuestion create(
            UUID id, UUID sessionId, UUID personId, String displayName,
            String channelType, String text, boolean anonymous, Integer slideIdx) {
        return jdbc.sql(
                        """
                        insert into qa.questions
                            (id, session_id, person_id, display_name, channel_type, text, status, anonymous, slide_idx)
                        values (:id, :sessionId, :personId, :displayName, :channelType,
                                :text, 'OPEN', :anonymous, :slideIdx)
                        returning id, session_id, display_name, channel_type, text, status, created_at,
                                  answer_text, answered_at, answer_visibility, anonymous, slide_idx
                        """)
                .param("id", id)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("displayName", anonymous ? "Анонимный вопрос" : displayName)
                .param("channelType", channelType)
                .param("text", text)
                .param("anonymous", anonymous)
                .param("slideIdx", slideIdx)
                .query(this::mapQuestion)
                .single();
    }

    List<StudentQuestion> openQuestions(UUID sessionId) {
        return jdbc.sql(
                        """
                        select id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at, answer_visibility, anonymous, slide_idx
                        from qa.questions
                        where session_id = :sessionId and status = 'OPEN'
                        order by created_at desc
                        limit 100
                        """)
                .param("sessionId", sessionId)
                .query(this::mapQuestion)
                .list();
    }

    QuestionPage list(UUID sessionId, QuestionStatus status, int limit, int offset, String query) {
        List<StudentQuestion> items = jdbc.sql(
                        """
                        select id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at, answer_visibility, anonymous, slide_idx
                        from qa.questions
                        where session_id = :sessionId and status = :status
                          and position(lower(:query) in lower(text)) > 0
                        order by created_at desc, id desc
                        limit :limit offset :offset
                        """)
                .param("sessionId", sessionId)
                .param("status", status.name())
                .param("query", query)
                .param("limit", limit)
                .param("offset", offset)
                .query(this::mapQuestion)
                .list();
        long total = jdbc.sql("""
                        select count(*) from qa.questions where session_id = :sessionId and status = :status
                          and position(lower(:query) in lower(text)) > 0
                        """)
                .param("sessionId", sessionId)
                .param("status", status.name())
                .param("query", query)
                .query(Long.class)
                .single();
        QuestionCounts counts = jdbc.sql("""
                        select count(*) filter (where status = 'OPEN') as open,
                               count(*) filter (where status = 'ANSWERED') as answered,
                               count(*) filter (where status = 'DISMISSED') as dismissed
                        from qa.questions where session_id = :sessionId
                        """)
                .param("sessionId", sessionId)
                .query((rs, row) -> new QuestionCounts(
                        rs.getLong("open"), rs.getLong("answered"), rs.getLong("dismissed")))
                .single();
        return new QuestionPage(items, total, limit, offset, counts);
    }

    java.util.Optional<StudentQuestion> find(UUID sessionId, UUID questionId) {
        return jdbc.sql(
                        """
                        select id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at, answer_visibility, anonymous, slide_idx
                        from qa.questions
                        where session_id = :sessionId and id = :questionId
                        """)
                .param("sessionId", sessionId)
                .param("questionId", questionId)
                .query(this::mapQuestion)
                .optional();
    }

    java.util.Optional<StudentQuestion> resolve(
            UUID sessionId,
            UUID questionId,
            QuestionStatus status,
            String answerText,
            QuestionAnswerVisibility answerVisibility) {
        return jdbc.sql(
                        """
                        update qa.questions set status = :status, answer_text = :answerText,
                            answer_visibility = :answerVisibility, answered_at = now()
                        where session_id = :sessionId and id = :questionId and status = 'OPEN'
                        returning id, session_id, display_name, channel_type, text, status, created_at,
                                  answer_text, answered_at, answer_visibility, anonymous, slide_idx
                        """)
                .param("sessionId", sessionId)
                .param("questionId", questionId)
                .param("status", status.name())
                .param("answerText", answerText)
                .param("answerVisibility", answerVisibility == null ? null : answerVisibility.name())
                .query(this::mapQuestion)
                .optional();
    }

    java.util.Optional<UUID> authorPersonId(UUID sessionId, UUID questionId) {
        return jdbc.sql("select person_id from qa.questions where session_id = :sessionId and id = :questionId")
                .param("sessionId", sessionId)
                .param("questionId", questionId)
                .query(UUID.class)
                .optional();
    }

    List<QuestionAnswerAudience> answeredQuestions(UUID sessionId) {
        return jdbc.sql(
                        """
                        select person_id, id, text, answer_text, answer_visibility, answered_at, slide_idx
                        from qa.questions
                        where session_id = :sessionId and status = 'ANSWERED'
                            and answer_text is not null and answer_visibility is not null
                        order by answered_at, id
                        """)
                .param("sessionId", sessionId)
                .query((rs, row) -> new QuestionAnswerAudience(
                        rs.getObject("person_id", UUID.class),
                        new StudentQuestionAnswer(
                                rs.getObject("id", UUID.class),
                                rs.getString("text"),
                                rs.getString("answer_text"),
                                QuestionAnswerVisibility.valueOf(rs.getString("answer_visibility")),
                                rs.getTimestamp("answered_at").toInstant(),
                                rs.getObject("slide_idx", Integer.class))))
                .list();
    }

    java.util.Map<UUID, List<StudentQuestion>> personalQuestions(UUID sessionId, java.util.Set<UUID> personIds) {
        if (personIds.isEmpty()) return java.util.Map.of();
        java.util.Map<UUID, List<StudentQuestion>> result = new java.util.HashMap<>();
        jdbc.sql("""
                        select person_id, id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at, answer_visibility, anonymous, slide_idx
                        from qa.questions where session_id = :sessionId and person_id in (:ids)
                        order by created_at, id
                        """).param("sessionId", sessionId).param("ids", personIds)
                .query((rs, row) -> {
                    UUID author = rs.getObject("person_id", UUID.class);
                    result.computeIfAbsent(author, key -> new java.util.ArrayList<>()).add(mapQuestion(rs, row));
                    return author;
                }).list();
        return result;
    }

    private StudentQuestion mapQuestion(ResultSet rs, int rowNumber) throws SQLException {
        return new StudentQuestion(
                rs.getObject("id", UUID.class),
                rs.getObject("session_id", UUID.class),
                rs.getBoolean("anonymous") ? "Анонимный вопрос" : rs.getString("display_name"),
                rs.getString("channel_type"),
                rs.getString("text"),
                QuestionStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toInstant(),
                rs.getString("answer_text"),
                rs.getTimestamp("answered_at") == null ? null : rs.getTimestamp("answered_at").toInstant(),
                rs.getString("answer_visibility") == null
                        ? null
                        : QuestionAnswerVisibility.valueOf(rs.getString("answer_visibility")),
                rs.getBoolean("anonymous"),
                rs.getObject("slide_idx", Integer.class));
    }
}
