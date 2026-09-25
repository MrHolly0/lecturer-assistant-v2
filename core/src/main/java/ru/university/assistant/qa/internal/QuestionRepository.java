package ru.university.assistant.qa.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.qa.api.QuestionAnswerAudience;
import ru.university.assistant.qa.api.QuestionAnswerVisibility;
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
            UUID id, UUID sessionId, UUID personId, String displayName, String channelType, String text) {
        return jdbc.sql(
                        """
                        insert into qa.questions (id, session_id, person_id, display_name, channel_type, text, status)
                        values (:id, :sessionId, :personId, :displayName, :channelType, :text, 'OPEN')
                        returning id, session_id, display_name, channel_type, text, status, created_at,
                                  answer_text, answered_at, answer_visibility
                        """)
                .param("id", id)
                .param("sessionId", sessionId)
                .param("personId", personId)
                .param("displayName", displayName)
                .param("channelType", channelType)
                .param("text", text)
                .query(this::mapQuestion)
                .single();
    }

    List<StudentQuestion> openQuestions(UUID sessionId) {
        return jdbc.sql(
                        """
                        select id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at, answer_visibility
                        from qa.questions
                        where session_id = :sessionId and status = 'OPEN'
                        order by created_at desc
                        limit 100
                        """)
                .param("sessionId", sessionId)
                .query(this::mapQuestion)
                .list();
    }

    java.util.Optional<StudentQuestion> find(UUID sessionId, UUID questionId) {
        return jdbc.sql(
                        """
                        select id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at, answer_visibility
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
                                  answer_text, answered_at, answer_visibility
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

    private StudentQuestion mapQuestion(ResultSet rs, int rowNumber) throws SQLException {
        return new StudentQuestion(
                rs.getObject("id", UUID.class),
                rs.getObject("session_id", UUID.class),
                rs.getString("display_name"),
                rs.getString("channel_type"),
                rs.getString("text"),
                QuestionStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toInstant(),
                rs.getString("answer_text"),
                rs.getTimestamp("answered_at") == null ? null : rs.getTimestamp("answered_at").toInstant(),
                rs.getString("answer_visibility") == null
                        ? null
                        : QuestionAnswerVisibility.valueOf(rs.getString("answer_visibility")));
    }
}
