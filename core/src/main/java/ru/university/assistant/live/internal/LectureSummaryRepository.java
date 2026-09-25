package ru.university.assistant.live.internal;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.interaction.api.PollStatus;
import ru.university.assistant.live.api.SummaryPollResult;
import ru.university.assistant.live.api.SummaryProblemSlide;
import ru.university.assistant.qa.api.QuestionStatus;
import ru.university.assistant.qa.api.StudentQuestion;

@Repository
class LectureSummaryRepository {
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    LectureSummaryRepository(JdbcClient jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    SignalAggregate signalTotals(UUID sessionId) {
        return signalTotals(sessionId, null);
    }

    SignalAggregate signalTotals(UUID sessionId, UUID groupId) {
        String groupFilter = groupFilter("comprehension_signals", groupId);
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select
                            count(*) filter (where value = 'GREEN')::int as green,
                            count(*) filter (where value = 'YELLOW')::int as yellow,
                            count(*) filter (where value = 'RED')::int as red,
                            count(*)::int as total
                        from feedback.comprehension_signals
                        where session_id = :sessionId
                        """ + groupFilter)
                .param("sessionId", sessionId);
        return bindGroup(query, sessionId, groupId)
                .query((rs, row) -> new SignalAggregate(
                        rs.getInt("green"), rs.getInt("yellow"), rs.getInt("red"), rs.getInt("total")))
                .single();
    }

    List<SummaryProblemSlide> problemSlides(UUID sessionId) {
        return problemSlides(sessionId, null);
    }

    List<SummaryProblemSlide> problemSlides(UUID sessionId, UUID groupId) {
        String groupFilter = groupFilter("comprehension_signals", groupId);
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select
                            slide_idx,
                            count(*) filter (where value = 'GREEN')::int as green,
                            count(*) filter (where value = 'YELLOW')::int as yellow,
                            count(*) filter (where value = 'RED')::int as red,
                            count(*)::int as total
                        from feedback.comprehension_signals
                        where session_id = :sessionId
                        """ + groupFilter + """
                        group by slide_idx
                        having count(*) filter (where value = 'RED') > 0
                        order by red desc, slide_idx asc
                        """)
                .param("sessionId", sessionId);
        return bindGroup(query, sessionId, groupId)
                .query((rs, row) -> new SummaryProblemSlide(
                        rs.getInt("slide_idx"),
                        rs.getInt("green"),
                        rs.getInt("yellow"),
                        rs.getInt("red"),
                        rs.getInt("total")))
                .list();
    }

    List<SummaryPollResult> pollResults(UUID sessionId) {
        return pollResults(sessionId, null);
    }

    List<SummaryPollResult> pollResults(UUID sessionId, UUID groupId) {
        return jdbc.sql("""
                        select id, source_question_id, question_text, options, status,
                               correct_option_idx, created_at, closed_at
                        from interaction.quick_polls
                        where session_id = :sessionId
                        order by created_at asc
                        """)
                .param("sessionId", sessionId)
                .query((rs, row) -> mapPoll(rs, sessionId, groupId))
                .list();
    }

    int questionCount(UUID sessionId) {
        return questionCount(sessionId, null);
    }

    int questionCount(UUID sessionId, UUID groupId) {
        JdbcClient.StatementSpec query = jdbc.sql("select count(*)::int from qa.questions where session_id = :sessionId"
                        + groupFilter("questions", groupId))
                .param("sessionId", sessionId);
        return bindGroup(query, sessionId, groupId).query(Integer.class)
                .single();
    }

    int unansweredQuestionCount(UUID sessionId, UUID groupId) {
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select count(*)::int
                        from qa.questions
                        where session_id = :sessionId and status = 'OPEN'
                        """ + groupFilter("questions", groupId))
                .param("sessionId", sessionId);
        return bindGroup(query, sessionId, groupId).query(Integer.class)
                .single();
    }

    List<StudentQuestion> unansweredQuestions(UUID sessionId) {
        return jdbc.sql("""
                        select id, session_id, display_name, channel_type, text, status, created_at,
                               answer_text, answered_at
                        from qa.questions
                        where session_id = :sessionId and status = 'OPEN'
                        order by created_at asc
                        """)
                .param("sessionId", sessionId)
                .query(this::mapQuestion)
                .list();
    }

    long pausedDurationSeconds(UUID sessionId, Instant endedAt) {
        List<SessionStatusEvent> statusEvents = jdbc.sql("""
                        select verb, occurred_at
                        from analytics.events
                        where aggregate_type = 'live.session' and aggregate_id = :sessionId
                            and verb in ('session.paused', 'session.resumed')
                        order by occurred_at, id
                        """)
                .param("sessionId", sessionId)
                .query((rs, row) -> new SessionStatusEvent(
                        rs.getString("verb"), rs.getTimestamp("occurred_at").toInstant()))
                .list();
        Instant pausedAt = null;
        long pausedSeconds = 0;
        for (SessionStatusEvent event : statusEvents) {
            if ("session.paused".equals(event.verb()) && pausedAt == null) {
                pausedAt = event.occurredAt();
            } else if ("session.resumed".equals(event.verb()) && pausedAt != null) {
                pausedSeconds += Math.max(0, Duration.between(pausedAt, event.occurredAt()).getSeconds());
                pausedAt = null;
            }
        }
        if (pausedAt != null) {
            pausedSeconds += Math.max(0, Duration.between(pausedAt, endedAt).getSeconds());
        }
        return pausedSeconds;
    }

    private SummaryPollResult mapPoll(ResultSet rs, UUID sessionId, UUID groupId) throws SQLException {
        UUID pollId = rs.getObject("id", UUID.class);
        List<String> options = options(rs.getString("options"));
        List<Integer> votes = voteCounts(pollId, sessionId, groupId, options.size());
        return new SummaryPollResult(
                pollId,
                rs.getObject("source_question_id", UUID.class),
                rs.getString("question_text"),
                options,
                PollStatus.valueOf(rs.getString("status")),
                votes,
                votes.stream().mapToInt(Integer::intValue).sum(),
                (Integer) rs.getObject("correct_option_idx"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("closed_at") == null ? null : rs.getTimestamp("closed_at").toInstant());
    }

    private List<Integer> voteCounts(UUID pollId, UUID sessionId, UUID groupId, int optionCount) {
        List<Integer> result = new ArrayList<>();
        for (int i = 0; i < optionCount; i++) {
            result.add(0);
        }
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select option_idx, count(*)::int as count
                        from interaction.poll_responses poll_responses
                        where poll_id = :pollId
                        """ + groupFilter("poll_responses", groupId) + """
                        group by option_idx
                        """)
                .param("pollId", pollId);
        bindGroup(query, sessionId, groupId).query((rs, row) -> {
                    int option = rs.getInt("option_idx");
                    if (option >= 0 && option < result.size()) {
                        result.set(option, rs.getInt("count"));
                    }
                    return option;
                })
                .list();
        return result;
    }

    private String groupFilter(String personTable, UUID groupId) {
        return groupId == null
                ? ""
                : " and exists (select 1 from live.session_participants sp"
                        + " where sp.session_id = :sessionId"
                        + " and sp.person_id = " + personTable + ".person_id"
                        + " and sp.group_id = :groupId)";
    }

    private JdbcClient.StatementSpec bindGroup(
            JdbcClient.StatementSpec query, UUID sessionId, UUID groupId) {
        return groupId == null
                ? query
                : query.param("sessionId", sessionId).param("groupId", groupId);
    }

    private StudentQuestion mapQuestion(ResultSet rs, int row) throws SQLException {
        return new StudentQuestion(
                rs.getObject("id", UUID.class),
                rs.getObject("session_id", UUID.class),
                rs.getString("display_name"),
                rs.getString("channel_type"),
                rs.getString("text"),
                QuestionStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toInstant(),
                rs.getString("answer_text"),
                rs.getTimestamp("answered_at") == null ? null : rs.getTimestamp("answered_at").toInstant());
    }

    private List<String> options(String json) {
        try {
            return mapper.readValue(json, STRING_LIST);
        } catch (Exception exception) {
            throw new IllegalStateException("Cannot read poll options", exception);
        }
    }
}
