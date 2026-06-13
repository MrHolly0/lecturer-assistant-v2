package ru.university.assistant.interaction.internal;

import com.fasterxml.jackson.core.type.TypeReference;
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
import ru.university.assistant.interaction.api.QuestionBankEntry;
import ru.university.assistant.interaction.api.QuestionOption;
import ru.university.assistant.interaction.api.QuestionType;

@Repository
class QuestionBankRepository {
    private static final TypeReference<List<QuestionOption>> OPTION_LIST = new TypeReference<>() {};

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    QuestionBankRepository(JdbcClient jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    QuestionBankEntry create(UUID id, UUID courseId, UUID createdBy, String text,
            QuestionType type, List<QuestionOption> options, List<String> tags) {
        String optionsJson = toJson(options);
        String[] tagsArray = tags == null ? new String[0] : tags.toArray(new String[0]);
        return jdbc.sql("""
                        insert into interaction.question_bank
                            (id, course_id, text, question_type, options, tags, created_by)
                        values (:id, :courseId, :text, :type, :options::jsonb, :tags, :createdBy)
                        returning id, course_id, text, question_type, options, tags,
                                  archived, created_at
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .param("text", text)
                .param("type", type.name())
                .param("options", optionsJson)
                .param("tags", tagsArray)
                .param("createdBy", createdBy)
                .query(this::map)
                .single();
    }

    Optional<QuestionBankEntry> findById(UUID id) {
        return jdbc.sql("""
                        select id, course_id, text, question_type, options, tags, archived, created_at
                        from interaction.question_bank
                        where id = :id and not archived
                        """)
                .param("id", id)
                .query(this::map)
                .optional();
    }

    List<QuestionBankEntry> findByCourse(UUID courseId, String tag) {
        String sql = tag == null
                ? """
                select id, course_id, text, question_type, options, tags, archived, created_at
                from interaction.question_bank
                where course_id = :courseId and not archived
                order by created_at desc
                """
                : """
                select id, course_id, text, question_type, options, tags, archived, created_at
                from interaction.question_bank
                where course_id = :courseId and not archived and :tag = any(tags)
                order by created_at desc
                """;
        var q = jdbc.sql(sql).param("courseId", courseId);
        if (tag != null) {
            q = q.param("tag", tag);
        }
        return q.query(this::map).list();
    }

    Optional<QuestionBankEntry> update(UUID id, String text, List<QuestionOption> options,
            List<String> tags) {
        String optionsJson = toJson(options);
        String[] tagsArray = tags == null ? new String[0] : tags.toArray(new String[0]);
        return jdbc.sql("""
                        update interaction.question_bank
                        set text = :text, options = :options::jsonb, tags = :tags
                        where id = :id and not archived
                        returning id, course_id, text, question_type, options, tags,
                                  archived, created_at
                        """)
                .param("id", id)
                .param("text", text)
                .param("options", optionsJson)
                .param("tags", tagsArray)
                .query(this::map)
                .optional();
    }

    boolean archive(UUID id) {
        return jdbc.sql("""
                        update interaction.question_bank
                        set archived = true
                        where id = :id and not archived
                        """)
                .param("id", id)
                .update() > 0;
    }

    private QuestionBankEntry map(ResultSet rs, int row) throws SQLException {
        List<QuestionOption> options = fromJson(rs.getString("options"));
        Array tagsArray = rs.getArray("tags");
        List<String> tags = tagsArray != null
                ? Arrays.asList((String[]) tagsArray.getArray())
                : List.of();
        return new QuestionBankEntry(
                rs.getObject("id", UUID.class),
                rs.getObject("course_id", UUID.class),
                rs.getString("text"),
                QuestionType.valueOf(rs.getString("question_type")),
                options,
                tags,
                rs.getBoolean("archived"),
                rs.getTimestamp("created_at").toInstant());
    }

    private String toJson(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new RuntimeException("JSON serialisation failed", e);
        }
    }

    private List<QuestionOption> fromJson(String json) {
        if (json == null) return List.of();
        try {
            return mapper.readValue(json, OPTION_LIST);
        } catch (Exception e) {
            return List.of();
        }
    }
}
