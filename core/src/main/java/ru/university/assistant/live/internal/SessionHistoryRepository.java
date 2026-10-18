package ru.university.assistant.live.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
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

    List<SessionHistoryItem> list(
            UUID courseId, String query, UUID groupId, Instant endedFrom, Instant endedBefore, int limit, int offset) {
        SqlFilter filter = filter(courseId, query, groupId, endedFrom, endedBefore);
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
                        """ + filter.sql() + """
                        order by s.ended_at desc, s.id desc
                        limit :limit offset :offset
                        """)
                .params(filter.parameters())
                .param("limit", limit)
                .param("offset", offset)
                .query(this::map)
                .list();
    }

    long count(UUID courseId, String query, UUID groupId, Instant endedFrom, Instant endedBefore) {
        SqlFilter filter = filter(courseId, query, groupId, endedFrom, endedBefore);
        return jdbc.sql("""
                        select count(*)
                        from live.sessions s
                        join live.lectures l on l.id = s.lecture_id
                        where l.course_id = :courseId
                          and s.status in ('ENDED', 'ARCHIVED')
                          and s.started_at is not null
                          and s.ended_at is not null
                        """ + filter.sql())
                .params(filter.parameters())
                .query(Long.class)
                .single();
    }

    List<SessionGroup> availableGroups(UUID courseId) {
        return jdbc.sql("""
                        select group_id, group_name_snapshot
                        from (
                            select distinct on (sg.group_id)
                                   sg.group_id, sg.group_name_snapshot
                            from live.sessions s
                            join live.lectures l on l.id = s.lecture_id
                            join live.session_groups sg on sg.session_id = s.id
                            where l.course_id = :courseId
                              and s.status in ('ENDED', 'ARCHIVED')
                              and s.started_at is not null
                              and s.ended_at is not null
                            order by sg.group_id, s.ended_at desc, s.id desc
                        ) latest_groups
                        order by group_name_snapshot, group_id
                        """)
                .param("courseId", courseId)
                .query((rs, row) -> new SessionGroup(
                        rs.getObject("group_id", UUID.class), rs.getString("group_name_snapshot")))
                .list();
    }

    private SqlFilter filter(UUID courseId, String query, UUID groupId, Instant endedFrom, Instant endedBefore) {
        StringBuilder sql = new StringBuilder();
        if (query != null && !query.isEmpty()) {
            sql.append("""
                      and (
                          lower(l.title) like :queryPattern escape E'\\\\'
                          or exists (
                              select 1 from live.session_groups sg_filter
                              where sg_filter.session_id = s.id
                                and lower(sg_filter.group_name_snapshot) like :queryPattern escape E'\\\\'
                          )
                      )
                    """);
        }
        if (groupId != null) {
            sql.append("""
                      and exists (
                          select 1 from live.session_groups sg_filter
                          where sg_filter.session_id = s.id and sg_filter.group_id = :groupId
                      )
                    """);
        }
        if (endedFrom != null) {
            sql.append(" and s.ended_at >= :endedFrom ");
        }
        if (endedBefore != null) {
            sql.append(" and s.ended_at < :endedBefore ");
        }
        var parameters = new java.util.LinkedHashMap<String, Object>();
        parameters.put("courseId", courseId);
        if (query != null && !query.isEmpty()) {
            parameters.put("queryPattern", "%" + escapeLike(query.toLowerCase(java.util.Locale.ROOT)) + "%");
        }
        if (groupId != null) {
            parameters.put("groupId", groupId);
        }
        if (endedFrom != null) {
            parameters.put("endedFrom", Timestamp.from(endedFrom));
        }
        if (endedBefore != null) {
            parameters.put("endedBefore", Timestamp.from(endedBefore));
        }
        return new SqlFilter(sql.toString(), parameters);
    }

    private String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private record SqlFilter(String sql, java.util.Map<String, Object> parameters) {}

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
