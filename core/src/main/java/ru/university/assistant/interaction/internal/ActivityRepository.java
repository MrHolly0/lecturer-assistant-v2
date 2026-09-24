package ru.university.assistant.interaction.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.interaction.api.ActivityDefinition;
import ru.university.assistant.interaction.api.ActivityResponse;
import ru.university.assistant.interaction.api.ActivityRun;
import ru.university.assistant.interaction.api.ActivityRunStatus;
import ru.university.assistant.interaction.api.ActivityStrategy;

@Repository
class ActivityRepository {
    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    ActivityRepository(JdbcClient jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    ActivityDefinition createDefinition(UUID id, UUID courseId, UUID createdBy,
            String title, List<UUID> questionIds, ActivityStrategy strategy, Integer strategyN) {
        UUID[] ids = questionIds.toArray(new UUID[0]);
        return jdbc.sql("""
                        insert into interaction.activity_definitions
                            (id, course_id, title, question_ids, strategy, strategy_n, created_by)
                        values (:id, :courseId, :title, :questionIds, :strategy, :strategyN, :createdBy)
                        returning id, course_id, title, question_ids, strategy, strategy_n,
                                  archived, created_at
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .param("title", title)
                .param("questionIds", ids)
                .param("strategy", strategy.name())
                .param("strategyN", strategyN)
                .param("createdBy", createdBy)
                .query(this::mapDefinition)
                .single();
    }

    // D-10: определение активности обязано принадлежать курсу из пути, иначе чужой преподаватель
    // может запустить прогон по чужому банку вопросов через свою собственную сессию.
    Optional<ActivityDefinition> findDefinitionByIdAndCourse(UUID id, UUID courseId) {
        return jdbc.sql("""
                        select id, course_id, title, question_ids, strategy, strategy_n,
                               archived, created_at
                        from interaction.activity_definitions
                        where id = :id and course_id = :courseId and not archived
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .query(this::mapDefinition)
                .optional();
    }

    List<ActivityDefinition> findDefinitionsByCourse(UUID courseId) {
        return jdbc.sql("""
                        select id, course_id, title, question_ids, strategy, strategy_n,
                               archived, created_at
                        from interaction.activity_definitions
                        where course_id = :courseId and not archived
                        order by created_at desc
                        """)
                .param("courseId", courseId)
                .query(this::mapDefinition)
                .list();
    }

    ActivityRun createRun(UUID id, UUID definitionId, UUID sessionId, List<UUID> questionIds) {
        UUID[] ids = questionIds.toArray(new UUID[0]);
        return jdbc.sql("""
                        insert into interaction.activity_runs
                            (id, definition_id, session_id, question_ids)
                        values (:id, :definitionId, :sessionId, :questionIds)
                        returning id, definition_id, session_id, status, question_ids,
                                  started_at, closed_at
                        """)
                .param("id", id)
                .param("definitionId", definitionId)
                .param("sessionId", sessionId)
                .param("questionIds", ids)
                .query(this::mapRun)
                .single();
    }

    Optional<ActivityRun> findRunById(UUID id) {
        return jdbc.sql("""
                        select id, definition_id, session_id, status, question_ids,
                               started_at, closed_at
                        from interaction.activity_runs
                        where id = :id
                        """)
                .param("id", id)
                .query(this::mapRun)
                .optional();
    }

    Optional<ActivityRun> closeRun(UUID id) {
        return jdbc.sql("""
                        update interaction.activity_runs
                        set status = 'CLOSED', closed_at = now()
                        where id = :id and status = 'OPEN'
                        returning id, definition_id, session_id, status, question_ids,
                                  started_at, closed_at
                        """)
                .param("id", id)
                .query(this::mapRun)
                .optional();
    }

    ActivityResponse submitResponse(UUID id, UUID runId, UUID personId, UUID questionId,
            JsonNode answer) {
        String answerJson = toJson(answer);
        return jdbc.sql("""
                        insert into interaction.activity_responses
                            (id, run_id, person_id, question_id, answer)
                        values (:id, :runId, :personId, :questionId, :answer::jsonb)
                        on conflict (run_id, person_id, question_id) do update
                            set answer = excluded.answer, answered_at = now()
                        returning id, run_id, person_id, question_id, answer, answered_at
                        """)
                .param("id", id)
                .param("runId", runId)
                .param("personId", personId)
                .param("questionId", questionId)
                .param("answer", answerJson)
                .query(this::mapResponse)
                .single();
    }

    List<ActivityResponse> findResponsesByRun(UUID runId) {
        return jdbc.sql("""
                        select id, run_id, person_id, question_id, answer, answered_at
                        from interaction.activity_responses
                        where run_id = :runId
                        order by answered_at
                        """)
                .param("runId", runId)
                .query(this::mapResponse)
                .list();
    }

    private ActivityDefinition mapDefinition(ResultSet rs, int row) throws SQLException {
        return new ActivityDefinition(
                rs.getObject("id", UUID.class),
                rs.getObject("course_id", UUID.class),
                rs.getString("title"),
                uuidList(rs.getArray("question_ids")),
                ActivityStrategy.valueOf(rs.getString("strategy")),
                (Integer) rs.getObject("strategy_n"),
                rs.getBoolean("archived"),
                rs.getTimestamp("created_at").toInstant());
    }

    private ActivityRun mapRun(ResultSet rs, int row) throws SQLException {
        return new ActivityRun(
                rs.getObject("id", UUID.class),
                rs.getObject("definition_id", UUID.class),
                rs.getObject("session_id", UUID.class),
                ActivityRunStatus.valueOf(rs.getString("status")),
                uuidList(rs.getArray("question_ids")),
                rs.getTimestamp("started_at").toInstant(),
                rs.getTimestamp("closed_at") != null ? rs.getTimestamp("closed_at").toInstant() : null);
    }

    private ActivityResponse mapResponse(ResultSet rs, int row) throws SQLException {
        return new ActivityResponse(
                rs.getObject("id", UUID.class),
                rs.getObject("run_id", UUID.class),
                rs.getObject("person_id", UUID.class),
                rs.getObject("question_id", UUID.class),
                fromJson(rs.getString("answer")),
                rs.getTimestamp("answered_at").toInstant());
    }

    private List<UUID> uuidList(Array array) throws SQLException {
        if (array == null) return List.of();
        Object[] raw = (Object[]) array.getArray();
        return Arrays.stream(raw).map(o -> UUID.fromString(o.toString())).toList();
    }

    private String toJson(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new RuntimeException("JSON serialisation failed", e);
        }
    }

    private JsonNode fromJson(String json) {
        try {
            return mapper.readTree(json);
        } catch (Exception e) {
            return mapper.nullNode();
        }
    }
}
