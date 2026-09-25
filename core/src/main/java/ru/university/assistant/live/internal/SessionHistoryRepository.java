package ru.university.assistant.live.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.live.api.SessionHistoryItem;
import ru.university.assistant.live.api.SessionGroup;
import ru.university.assistant.live.api.SessionStatus;

@Repository
class SessionHistoryRepository {
    private static final TypeReference<List<SessionGroup>> GROUP_LIST_TYPE = new TypeReference<>() {};

    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    SessionHistoryRepository(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    List<SessionHistoryItem> list(UUID courseId, int limit, int offset) {
        return jdbc.sql("""
                        select s.id, s.lecture_id, l.title as lecture_title,
                               coalesce((select jsonb_agg(jsonb_build_object(
                                               'id', sg.group_id, 'name', sg.group_name_snapshot)
                                           order by sg.group_name_snapshot, sg.group_id)
                                         from live.session_groups sg
                                         where sg.session_id = s.id), '[]'::jsonb)::text as groups,
                               s.status,
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
                readGroups(rs.getString("groups")),
                SessionStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("started_at").toInstant(),
                rs.getTimestamp("ended_at").toInstant());
    }

    private List<SessionGroup> readGroups(String json) {
        try {
            return objectMapper.readValue(json == null ? "[]" : json, GROUP_LIST_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot read session groups", exception);
        }
    }
}
