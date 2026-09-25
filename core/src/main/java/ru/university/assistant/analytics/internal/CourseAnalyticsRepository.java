package ru.university.assistant.analytics.internal;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.analytics.api.AnalyticsGroupRef;
import ru.university.assistant.analytics.api.LearningMetrics;

@Repository
class CourseAnalyticsRepository {
    private final JdbcClient jdbc;

    CourseAnalyticsRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    List<AnalyticsGroupRef> groups(UUID courseId) {
        return jdbc.sql("""
                        select id, name
                        from org.study_groups
                        where course_id = :courseId
                        order by name, id
                        """)
                .param("courseId", courseId)
                .query((rs, row) -> new AnalyticsGroupRef(
                        rs.getObject("id", UUID.class), rs.getString("name")))
                .list();
    }

    boolean groupExists(UUID courseId, UUID groupId) {
        return jdbc.sql("select count(*) from org.study_groups where course_id = :courseId and id = :groupId")
                .param("courseId", courseId)
                .param("groupId", groupId)
                .query(Long.class)
                .single() > 0;
    }

    List<UUID> stableStudentIds(UUID courseId, UUID groupId, boolean ungrouped) {
        String groupFilter = groupId != null
                ? """
                and exists (select 1 from org.group_members gm
                            where gm.person_id = cm.person_id and gm.group_id = :groupId)
                """
                : ungrouped
                        ? """
                        and not exists (select 1 from org.group_members gm
                                        join org.study_groups g on g.id = gm.group_id
                                        where gm.person_id = cm.person_id and g.course_id = :courseId)
                        """
                        : "";
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select cm.person_id
                        from org.course_members cm
                        join iam.persons p on p.id = cm.person_id
                        where cm.course_id = :courseId and cm.role = 'STUDENT' and p.status <> 'EPHEMERAL'
                        """ + groupFilter + " order by cm.person_id")
                .param("courseId", courseId);
        if (groupId != null) {
            query = query.param("groupId", groupId);
        }
        return query.query(UUID.class).list();
    }

    List<AnalyticsStudent> students(UUID courseId, UUID groupId, int limit, int offset) {
        String groupFilter = groupId == null
                ? ""
                : """
                and exists (select 1 from org.group_members gm
                            where gm.person_id = cm.person_id and gm.group_id = :groupId)
                """;
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select cm.person_id, p.display_name
                        from org.course_members cm
                        join iam.persons p on p.id = cm.person_id
                        where cm.course_id = :courseId and cm.role = 'STUDENT' and p.status <> 'EPHEMERAL'
                        """ + groupFilter + " order by p.display_name, cm.person_id limit :limit offset :offset")
                .param("courseId", courseId)
                .param("limit", limit)
                .param("offset", offset);
        if (groupId != null) {
            query = query.param("groupId", groupId);
        }
        return query.query((rs, row) -> new AnalyticsStudent(
                        rs.getObject("person_id", UUID.class), rs.getString("display_name")))
                .list();
    }

    long studentCount(UUID courseId, UUID groupId) {
        String groupFilter = groupId == null
                ? ""
                : """
                and exists (select 1 from org.group_members gm
                            where gm.person_id = cm.person_id and gm.group_id = :groupId)
                """;
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select count(*)
                        from org.course_members cm
                        join iam.persons p on p.id = cm.person_id
                        where cm.course_id = :courseId and cm.role = 'STUDENT' and p.status <> 'EPHEMERAL'
                        """ + groupFilter)
                .param("courseId", courseId);
        if (groupId != null) {
            query = query.param("groupId", groupId);
        }
        return query.query(Long.class).single();
    }

    Optional<AnalyticsStudent> student(UUID courseId, UUID personId) {
        return jdbc.sql("""
                        select cm.person_id, p.display_name
                        from org.course_members cm
                        join iam.persons p on p.id = cm.person_id
                        where cm.course_id = :courseId and cm.person_id = :personId
                            and cm.role = 'STUDENT' and p.status <> 'EPHEMERAL'
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .query((rs, row) -> new AnalyticsStudent(
                        rs.getObject("person_id", UUID.class), rs.getString("display_name")))
                .optional();
    }

    List<AnalyticsGroupRef> groupsForStudent(UUID courseId, UUID personId) {
        return jdbc.sql("""
                        select g.id, g.name
                        from org.group_members gm
                        join org.study_groups g on g.id = gm.group_id
                        where g.course_id = :courseId and gm.person_id = :personId
                        order by g.name, g.id
                        """)
                .param("courseId", courseId)
                .param("personId", personId)
                .query((rs, row) -> new AnalyticsGroupRef(
                        rs.getObject("id", UUID.class), rs.getString("name")))
                .list();
    }

    LearningMetrics metrics(UUID courseId, List<UUID> personIds) {
        if (personIds.isEmpty()) {
            return emptyMetrics(0);
        }
        Scope scope = new Scope("%s.person_id in (:personIds)", personIds);
        return metrics(courseId, personIds.size(), scope);
    }

    LearningMetrics unidentifiedMetrics(UUID courseId) {
        Scope scope = new Scope(
                """
                (%s.person_id is null or exists (
                    select 1 from iam.persons ip
                    where ip.id = %s.person_id and ip.status = 'EPHEMERAL'))
                """,
                null);
        return metrics(courseId, 0, scope);
    }

    private LearningMetrics metrics(UUID courseId, int memberCount, Scope scope) {
        long[] attendance = attendance(courseId, scope);
        long[] signals = signals(courseId, scope);
        long[] checks = checks(courseId, scope);
        long[] questions = questions(courseId, scope);
        long signalCount = signals[0] + signals[1] + signals[2];
        return new LearningMetrics(
                memberCount,
                (int) attendance[0],
                attendance[1],
                signals[0],
                signals[1],
                signals[2],
                signalCount,
                share(signals[0], signalCount),
                share(signals[1], signalCount),
                share(signals[2], signalCount),
                checks[0],
                checks[1],
                checks[2],
                share(checks[2], checks[1]),
                questions[0],
                questions[1]);
    }

    private long[] attendance(UUID courseId, Scope scope) {
        String predicate = scope.predicate().formatted("sp", "sp");
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select count(distinct sp.person_id) as participants,
                               count(distinct (sp.session_id, sp.person_id)) as attendances
                        from live.session_participants sp
                        join live.sessions s on s.id = sp.session_id
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId
                        """ + " and " + predicate)
                .param("courseId", courseId);
        query = bindScope(query, scope);
        return query.query((rs, row) -> new long[] {
                    rs.getLong("participants"), rs.getLong("attendances")
                })
                .single();
    }

    private long[] signals(UUID courseId, Scope scope) {
        String predicate = scope.predicate().formatted("cs", "cs");
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select count(*) filter (where cs.value = 'GREEN') as green,
                               count(*) filter (where cs.value = 'YELLOW') as yellow,
                               count(*) filter (where cs.value = 'RED') as red
                        from feedback.comprehension_signals cs
                        join live.sessions s on s.id = cs.session_id
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId
                        """ + " and " + predicate)
                .param("courseId", courseId);
        query = bindScope(query, scope);
        return query.query((rs, row) -> new long[] {
                    rs.getLong("green"), rs.getLong("yellow"), rs.getLong("red")
                })
                .single();
    }

    private long[] checks(UUID courseId, Scope scope) {
        String predicate = scope.predicate().formatted("answers", "answers");
        JdbcClient.StatementSpec query = jdbc.sql("""
                        with answers as (
                            select pr.person_id,
                                   qp.correct_option_idx is not null as graded,
                                   qp.correct_option_idx is not null
                                       and pr.option_idx = qp.correct_option_idx as correct
                            from interaction.poll_responses pr
                            join interaction.quick_polls qp on qp.id = pr.poll_id
                            join live.sessions s on s.id = qp.session_id
                            join live.lectures l on l.id = s.lecture_id
                            where l.course_id = :courseId and qp.status = 'CLOSED'
                            union all
                            select ar.person_id,
                                   ci.correct_idx is not null and ai.answer_idx is not null as graded,
                                   ci.correct_idx is not null and ai.answer_idx = ci.correct_idx as correct
                            from interaction.activity_responses ar
                            join interaction.activity_runs run on run.id = ar.run_id
                            join live.sessions s on s.id = run.session_id
                            join live.lectures l on l.id = s.lecture_id
                            join interaction.question_bank qb on qb.id = ar.question_id
                            left join lateral (
                                select case
                                    when (ar.answer ->> 'optionIdx') ~ '^[0-9]+$'
                                    then (ar.answer ->> 'optionIdx')::int
                                    else null
                                end as answer_idx
                            ) ai on true
                            left join lateral (
                                select (option_row.ordinality - 1)::int as correct_idx
                                from jsonb_array_elements(qb.options) with ordinality option_row(value, ordinality)
                                where coalesce((option_row.value ->> 'correct')::boolean, false)
                                order by option_row.ordinality
                                limit 1
                            ) ci on true
                            where l.course_id = :courseId and run.status = 'CLOSED'
                        )
                        select count(*) as answers,
                               count(*) filter (where graded) as graded,
                               count(*) filter (where correct) as correct
                        from answers
                        """ + " where " + predicate)
                .param("courseId", courseId);
        query = bindScope(query, scope);
        return query.query((rs, row) -> new long[] {
                    rs.getLong("answers"), rs.getLong("graded"), rs.getLong("correct")
                })
                .single();
    }

    private long[] questions(UUID courseId, Scope scope) {
        String predicate = scope.predicate().formatted("q", "q");
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select count(*) as questions,
                               count(*) filter (where q.status = 'ANSWERED') as answered
                        from qa.questions q
                        join live.sessions s on s.id = q.session_id
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId
                        """ + " and " + predicate)
                .param("courseId", courseId);
        query = bindScope(query, scope);
        return query.query((rs, row) -> new long[] {
                    rs.getLong("questions"), rs.getLong("answered")
                })
                .single();
    }

    private JdbcClient.StatementSpec bindScope(JdbcClient.StatementSpec query, Scope scope) {
        return scope.personIds() == null ? query : query.param("personIds", scope.personIds());
    }

    private LearningMetrics emptyMetrics(int memberCount) {
        return new LearningMetrics(
                memberCount, 0, 0, 0, 0, 0, 0, null, null, null,
                0, 0, 0, null, 0, 0);
    }

    private Double share(long numerator, long denominator) {
        return denominator == 0 ? null : (double) numerator / denominator;
    }

    private record Scope(String predicate, List<UUID> personIds) {}
}
