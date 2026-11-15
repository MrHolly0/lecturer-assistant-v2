package ru.university.assistant.live.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.StudentCabinet;

@Service
public class StudentCabinetService {
    private static final String SELECT = """
            select s.id, l.title, c.title as course_title, s.status, s.started_at, s.ended_at,
                case when s.status in ('SCHEDULED','LIVE','PAUSED') and not exists
                    (select 1 from iam.course_bans b where b.course_id=l.course_id and b.person_id=:person)
                    then s.join_code else null end as join_code,
                (select string_agg(g.group_name_snapshot, ', ' order by g.group_name_snapshot)
                    from live.session_groups g where g.session_id=s.id) as groups,
                p.joined_at, p.left_at, coalesce(p.joined,false) as joined
            from live.sessions s join live.lectures l on l.id=s.lecture_id
            join org.courses c on c.id=l.course_id
            left join (
                select session_id, min(joined_at) as joined_at, max(left_at) as left_at,
                    bool_or(left_at is null and not kicked) as joined
                from live.session_participants where person_id=:person group by session_id
            ) p on p.session_id=s.id
            """;
    private final JdbcClient jdbc;

    StudentCabinetService(JdbcClient jdbc) { this.jdbc = jdbc; }

    public StudentCabinet cabinet(AuthenticatedUser user, int limit, int offset) {
        if (limit < 1 || limit > 50 || offset < 0 || offset > 1_000_000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid history page");
        }
        var ongoing = jdbc.sql(SELECT + """
                where s.status in ('SCHEDULED','LIVE','PAUSED') and not c.archived
                    and not exists(select 1 from iam.course_bans b
                        where b.course_id=l.course_id and b.person_id=:person)
                    and (p.joined_at is not null or exists (
                        select 1 from live.session_groups sg join org.study_groups target on target.id=sg.group_id
                        join org.study_groups mine on mine.id=target.id
                            or (mine.cohort_key is not null and mine.cohort_key=target.cohort_key)
                        join org.group_members gm on gm.group_id=mine.id and gm.person_id=:person
                        where sg.session_id=s.id))
                order by s.started_at desc nulls last, s.created_at desc limit 101
                """).param("person", user.id()).query(this::entry).list();
        var history = jdbc.sql(SELECT + """
                where p.joined_at is not null order by p.joined_at desc, s.id desc limit :limit offset :offset
                """).param("person", user.id()).param("limit", limit).param("offset", offset)
                .query(this::entry).list();
        long total = jdbc.sql("select count(distinct session_id) from live.session_participants where person_id=:id")
                .param("id", user.id()).query(Long.class).single();
        return new StudentCabinet(ongoing.stream().limit(100).toList(), ongoing.size() > 100,
                history, total, limit, offset);
    }

    private StudentCabinet.Entry entry(ResultSet rs, int row) throws SQLException {
        return new StudentCabinet.Entry(rs.getObject("id", UUID.class), rs.getString("title"),
                rs.getString("course_title"), rs.getString("groups"), rs.getString("join_code"),
                rs.getString("status"), rs.getBoolean("joined"), instant(rs, "started_at"),
                instant(rs, "ended_at"), instant(rs, "joined_at"), instant(rs, "left_at"));
    }

    private static Instant instant(ResultSet rs, String name) throws SQLException {
        Timestamp value = rs.getTimestamp(name);
        return value == null ? null : value.toInstant();
    }
}
