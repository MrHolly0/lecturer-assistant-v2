package ru.university.assistant.interaction.internal;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.interaction.api.PollStatus;
import ru.university.assistant.interaction.api.QuickPoll;

@Repository
class PollRepository {
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    PollRepository(JdbcClient jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    QuickPoll create(
            UUID id,
            UUID sessionId,
            UUID createdBy,
            UUID sourceQuestionId,
            String questionText,
            List<String> options,
            Integer correctOptionIdx) {
        String optionsJson = toJson(options);
        return jdbc.sql("""
                        insert into interaction.quick_polls
                            (id, session_id, source_question_id, question_text, options, status,
                             correct_option_idx, created_by)
                        values (:id, :sessionId, :sourceQuestionId, :questionText, :options::jsonb, 'OPEN',
                                :correctOptionIdx, :createdBy)
                        returning id, session_id, source_question_id, question_text, options, status,
                                  correct_option_idx, created_at, closed_at
                        """)
                .param("id", id)
                .param("sessionId", sessionId)
                .param("sourceQuestionId", sourceQuestionId)
                .param("questionText", questionText)
                .param("options", optionsJson)
                .param("correctOptionIdx", correctOptionIdx)
                .param("createdBy", createdBy)
                .query(this::map)
                .single();
    }

    Optional<QuickPoll> findOpenForSession(UUID sessionId) {
        return jdbc.sql("""
                        select id, session_id, source_question_id, question_text, options, status,
                               correct_option_idx, created_at, closed_at
                        from interaction.quick_polls
                        where session_id = :sessionId and status = 'OPEN'
                        order by created_at desc
                        limit 1
                        """)
                .param("sessionId", sessionId)
                .query(this::map)
                .optional();
    }

    /** Открытый опрос важнее закрытого; если открытого нет, берётся последний закрытый. */
    Optional<QuickPoll> findLatestForSession(UUID sessionId) {
        return jdbc.sql("""
                        select id, session_id, source_question_id, question_text, options, status,
                               correct_option_idx, created_at, closed_at
                        from interaction.quick_polls
                        where session_id = :sessionId
                        order by (status = 'OPEN') desc, created_at desc
                        limit 1
                        """)
                .param("sessionId", sessionId)
                .query(this::map)
                .optional();
    }

    Optional<Integer> findVote(UUID pollId, UUID personId) {
        return jdbc.sql("select option_idx from interaction.poll_responses "
                        + "where poll_id = :pollId and person_id = :personId")
                .param("pollId", pollId)
                .param("personId", personId)
                .query(Integer.class)
                .optional();
    }

    Optional<QuickPoll> findById(UUID pollId) {
        return jdbc.sql("""
                        select id, session_id, source_question_id, question_text, options, status,
                               correct_option_idx, created_at, closed_at
                        from interaction.quick_polls
                        where id = :id
                        """)
                .param("id", pollId)
                .query(this::map)
                .optional();
    }

    QuickPoll close(UUID pollId, Integer correctOptionIdx) {
        return jdbc.sql("""
                        update interaction.quick_polls
                        set status = 'CLOSED',
                            correct_option_idx = coalesce(:correct, correct_option_idx),
                            closed_at = now()
                        where id = :id
                        returning id, session_id, source_question_id, question_text, options, status,
                                  correct_option_idx, created_at, closed_at
                        """)
                .param("id", pollId)
                .param("correct", correctOptionIdx)
                .query(this::map)
                .single();
    }

    boolean respond(UUID id, UUID pollId, UUID personId, int optionIdx) {
        int rows = jdbc.sql("""
                        insert into interaction.poll_responses (id, poll_id, person_id, option_idx)
                        values (:id, :pollId, :personId, :optionIdx)
                        on conflict (poll_id, person_id) do nothing
                        """)
                .param("id", id)
                .param("pollId", pollId)
                .param("personId", personId)
                .param("optionIdx", optionIdx)
                .update();
        return rows > 0;
    }

    List<Integer> voteCounts(UUID pollId, int optionCount) {
        List<Integer> counts = new ArrayList<>();
        for (int i = 0; i < optionCount; i++) {
            counts.add(0);
        }
        jdbc.sql("""
                        select option_idx, count(*)::int as cnt
                        from interaction.poll_responses
                        where poll_id = :pollId
                        group by option_idx
                        """)
                .param("pollId", pollId)
                .query((rs, rowNum) -> {
                    int idx = rs.getInt("option_idx");
                    int cnt = rs.getInt("cnt");
                    if (idx >= 0 && idx < counts.size()) {
                        counts.set(idx, cnt);
                    }
                    return null;
                })
                .list();
        return counts;
    }

    private QuickPoll map(ResultSet rs, int row) throws SQLException {
        List<String> options = fromJson(rs.getString("options"));
        return new QuickPoll(
                rs.getObject("id", UUID.class),
                rs.getObject("session_id", UUID.class),
                rs.getObject("source_question_id", UUID.class),
                rs.getString("question_text"),
                options,
                PollStatus.valueOf(rs.getString("status")),
                (Integer) rs.getObject("correct_option_idx"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("closed_at") != null ? rs.getTimestamp("closed_at").toInstant() : null);
    }

    private String toJson(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new RuntimeException("JSON serialisation failed", e);
        }
    }

    private List<String> fromJson(String json) {
        if (json == null) return List.of();
        try {
            return mapper.readValue(json, STRING_LIST);
        } catch (Exception e) {
            return List.of();
        }
    }
}
