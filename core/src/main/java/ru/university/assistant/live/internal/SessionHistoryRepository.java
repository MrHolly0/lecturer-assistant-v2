package ru.university.assistant.live.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.live.api.SessionHistoryItem;
import ru.university.assistant.live.api.SessionStatus;

@Repository
class SessionHistoryRepository {
    private final JdbcClient jdbc;

    SessionHistoryRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    List<SessionHistoryItem> list(UUID courseId, int limit, int offset) {
        return jdbc.sql("""
                        select s.id, s.lecture_id, l.title as lecture_title, s.status,
                               s.started_at, s.ended_at
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId
                          and s.status in ('ENDED', 'ARCHIVED')
                          and s.started_at is not null
                          and s.ended_at is not null
                        order by s.ended_at desc, s.id desc
                        limit :limit offset :offset
                        """)
                .param("courseId", courseId)
                .param("limit", limit)
                .param("offset", offset)
                .query(this::map)
                .list();
    }

    long count(UUID courseId) {
        return jdbc.sql("""
                        select count(*)
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId
                          and s.status in ('ENDED', 'ARCHIVED')
                          and s.started_at is not null
                          and s.ended_at is not null
                        """)
                .param("courseId", courseId)
                .query(Long.class)
                .single();
    }

    private SessionHistoryItem map(ResultSet rs, int row) throws SQLException {
        return new SessionHistoryItem(
                rs.getObject("id", UUID.class),
                rs.getObject("lecture_id", UUID.class),
                rs.getString("lecture_title"),
                SessionStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("started_at").toInstant(),
                rs.getTimestamp("ended_at").toInstant());
    }
}
