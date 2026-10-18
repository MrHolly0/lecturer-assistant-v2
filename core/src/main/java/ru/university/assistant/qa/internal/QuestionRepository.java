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

    StudentQuestion create(
            UUID id, UUID sessionId, UUID personId, String displayName,
            String channelType, String text, boolean anonymous) {
        return jdbc.sql(
                        """
                        insert into qa.questions
                            (id, session_id, person_id, display_name, channel_type, text, status, anonymous)
                        values (:id, :sessionId, :personId, :displayName, :channelType, :text, 'OPEN', :anonymous)
                        returning id, session_id, display_name, channel_type, text, status, created_at,
                                  answer_text, answered_at, answer_visibility, anonymous
                        """)
                .param("id", id)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("displayName", anonymous ? "Анонимный вопрос" : displayName)
                .param("channelType", channelType)
                .param("text", text)
                .param("anonymous", anonymous)
                .query(this::mapQuestion)
                .single();
    }

    List<StudentQuestion> openQuestions(UUID sessionId) {
        return jdbc.sql(
                        """
                        select id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at, answer_visibility, anonymous
                        from qa.questions
                        where session_id = :sessionId and status = 'OPEN'
                        order by created_at desc
                        limit 100
                        """)
                .param("sessionId", sessionId)
                .query(this::mapQuestion)
                .list();
    }

    QuestionPage list(UUID sessionId, QuestionStatus status, int limit, int offset) {
        List<StudentQuestion> items = jdbc.sql(
                        """
                        select id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at, answer_visibility, anonymous
                        from qa.questions
                        where session_id = :sessionId and status = :status
                        order by created_at desc, id desc
                        limit :limit offset :offset
                        """)
                .param("sessionId", sessionId)
                .param("status", status.name())
                .param("limit", limit)
                .param("offset", offset)
                .query(this::mapQuestion)
                .list();
        long total = jdbc.sql("select count(*) from qa.questions where session_id = :sessionId and status = :status")
                .param("sessionId", sessionId)
                .param("status", status.name())
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
                               answer_text, answered_at, answer_visibility, anonymous
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
                                  answer_text, answered_at, answer_visibility, anonymous
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
                        select person_id, id, text, answer_text, answer_visibility, answered_at
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
                                rs.getTimestamp("answered_at").toInstant())))
                .list();
    }

    java.util.Map<UUID, List<StudentQuestion>> personalQuestions(UUID sessionId, java.util.Set<UUID> personIds) {
        if (personIds.isEmpty()) return java.util.Map.of();
        java.util.Map<UUID, List<StudentQuestion>> result = new java.util.HashMap<>();
        jdbc.sql("""
                        select person_id, id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at, answer_visibility, anonymous
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
                rs.getBoolean("anonymous"));
    }
}
