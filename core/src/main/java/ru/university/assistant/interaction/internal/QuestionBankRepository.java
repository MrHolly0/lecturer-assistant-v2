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
                                  archived, created_at, ARRAY[]::uuid[] as lecture_ids
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

    // D-10: без courseId в WHERE любой преподаватель мог прочитать чужой вопрос вместе
    // с правильным ответом, зная только его id.
    Optional<QuestionBankEntry> findByIdAndCourse(UUID id, UUID courseId) {
        return jdbc.sql("""
                        select id, course_id, text, question_type, options, tags, archived, created_at,
                            array(select lecture_id from interaction.question_lectures ql
                                where ql.question_id = qb.id order by lecture_id) as lecture_ids
                        from interaction.question_bank qb
                        where id = :id and course_id = :courseId and not archived
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .query(this::map)
                .optional();
    }

    List<QuestionBankEntry> findByCourse(UUID courseId, String tag) {
        String sql = tag == null
                ? """
                select id, course_id, text, question_type, options, tags, archived, created_at,
                            array(select lecture_id from interaction.question_lectures ql
                                where ql.question_id = qb.id order by lecture_id) as lecture_ids
                from interaction.question_bank qb
                where course_id = :courseId and not archived
                order by created_at desc
                """
                : """
                select id, course_id, text, question_type, options, tags, archived, created_at,
                            array(select lecture_id from interaction.question_lectures ql
                                where ql.question_id = qb.id order by lecture_id) as lecture_ids
                from interaction.question_bank qb
                where course_id = :courseId and not archived and :tag = any(tags)
                order by created_at desc
                """;
        var q = jdbc.sql(sql).param("courseId", courseId);
        if (tag != null) {
            q = q.param("tag", tag);
        }
        return q.query(this::map).list();
    }

    Optional<QuestionBankEntry> update(UUID id, UUID courseId, String text, List<QuestionOption> options,
            List<String> tags) {
        String optionsJson = toJson(options);
        String[] tagsArray = tags == null ? new String[0] : tags.toArray(new String[0]);
        return jdbc.sql("""
                        update interaction.question_bank
                        set text = :text, options = :options::jsonb, tags = :tags
                        where id = :id and course_id = :courseId and not archived
                        returning id, course_id, text, question_type, options, tags,
                                  archived, created_at, ARRAY[]::uuid[] as lecture_ids
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .param("text", text)
                .param("options", optionsJson)
                .param("tags", tagsArray)
                .query(this::map)
                .optional();
    }

    boolean archive(UUID id, UUID courseId) {
        return jdbc.sql("""
                        update interaction.question_bank
                        set archived = true
                        where id = :id and course_id = :courseId and not archived
                        """)
                .param("id", id)
                .param("courseId", courseId)
                .update() > 0;
    }

    boolean lock(UUID courseId, UUID id) {
        return jdbc.sql("""
                select id from interaction.question_bank
                where course_id = :course and id = :id and not archived for update
                """).param("course", courseId).param("id", id).query(UUID.class).optional().isPresent();
    }

    boolean lectureExists(UUID courseId, UUID lectureId) {
        return jdbc.sql("select exists(select 1 from live.lectures where id = :id and course_id = :course)")
                .param("id", lectureId).param("course", courseId).query(Boolean.class).single();
    }

    void link(UUID courseId, UUID questionId, UUID lectureId) {
        jdbc.sql("""
                insert into interaction.question_lectures (course_id, question_id, lecture_id)
                values (:course, :question, :lecture) on conflict do nothing
                """).param("course", courseId).param("question", questionId).param("lecture", lectureId).update();
    }

    void unlink(UUID courseId, UUID questionId, UUID lectureId) {
        jdbc.sql("""
                delete from interaction.question_lectures
                where course_id = :course and question_id = :question and lecture_id = :lecture
                """).param("course", courseId).param("question", questionId).param("lecture", lectureId).update();
    }

    void replaceLinks(UUID courseId, UUID questionId, List<UUID> lectureIds) {
        jdbc.sql("delete from interaction.question_lectures where course_id = :course and question_id = :question")
                .param("course", courseId).param("question", questionId).update();
        lectureIds.stream().distinct().forEach(id -> link(courseId, questionId, id));
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
                rs.getTimestamp("created_at").toInstant(),
                Arrays.asList((UUID[]) rs.getArray("lecture_ids").getArray()));
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
