package ru.university.assistant.org.internal;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.org.api.GroupFormatPolicy;
import ru.university.assistant.org.api.GroupFormatPreview;

@Service
public class GroupFormatService {
    private final JdbcClient jdbc;
    private final ObjectMapper json;

    GroupFormatService(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public GroupFormatPolicy policy() {
        return jdbc.sql("select revision, enabled, fields::text from org.group_format_policy where singleton")
                .query((rs, row) -> new GroupFormatPolicy(rs.getLong(1), rs.getBoolean(2), fields(rs.getString(3))))
                .single();
    }

    @Transactional
    public GroupFormatPolicy save(AuthenticatedUser actor, GroupFormatPolicy requested) {
        admin(actor);
        try {
            GroupFormatEngine.validate(requested);
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage());
        }
        int count = jdbc.sql("""
                update org.group_format_policy set revision=revision+1, enabled=:enabled,
                    fields=cast(:fields as jsonb), updated_at=now() where singleton and revision=:revision
                """)
                .param("enabled", requested.enabled()).param("revision", requested.revision())
                .param("fields", encode(requested.fields())).update();
        if (count == 0) throw new ResponseStatusException(
                HttpStatus.CONFLICT, "Формат уже изменил другой администратор");
        return policy();
    }

    public GroupFormatPreview preview(String name, Map<String, String> parts) {
        GroupFormatPolicy policy = policy();
        try { return parts == null ? GroupFormatEngine.parse(policy, name) : GroupFormatEngine.compose(policy, parts); }
        catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage());
        }
    }

    public GroupFormatPreview previewDraft(AuthenticatedUser actor, GroupFormatPolicy draft, String name) {
        admin(actor);
        if (draft == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Укажите формат групп");
        try { return GroupFormatEngine.parse(draft, name); }
        catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage());
        }
    }

    GroupFormatPreview normalize(String name, Map<String, String> parts) {
        jdbc.sql("select singleton from org.group_format_policy where singleton for share")
                .query(Boolean.class).single();
        var preview = preview(name, parts);
        if (!preview.valid()) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, preview.message());
        return preview;
    }

    void attach(UUID groupId, GroupFormatPreview normalized) {
        attach(groupId, normalized, false);
    }

    private void attach(UUID groupId, GroupFormatPreview normalized, boolean reviewed) {
        if (normalized.identityKey() == null) return;
        int changed = jdbc.sql("""
                update org.study_groups set cohort_key=:key, cohort_parts=cast(:parts as jsonb),
                    format_revision=:revision where id=:id
                    and (:reviewed or cohort_key is null or cohort_key=:key)
                """).param("key", normalized.identityKey()).param("parts", encode(normalized.parts()))
                .param("revision", policy().revision()).param("id", groupId).param("reviewed", reviewed).update();
        if (changed != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Такое название уже относится к другой структуре группы. Проверьте формат");
        }
    }

    /** Explicit admin action links structural identities; it never merges rows or rewrites history. */
    @Transactional
    public ReconcileResult reconcile(AuthenticatedUser actor, long expectedRevision) {
        admin(actor);
        jdbc.sql("select singleton from org.group_format_policy where singleton for update")
                .query(Boolean.class).single();
        var policy = policy();
        if (policy.revision() != expectedRevision || !policy.enabled()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Проверьте актуальный формат учреждения");
        }
        var groups = jdbc.sql("select id, name from org.study_groups where format_revision is distinct from :revision "
                + " order by created_at limit 1001").param("revision", expectedRevision)
                .query((rs, n) -> Map.entry(rs.getObject(1, UUID.class), rs.getString(2))).list();
        int matched = 0;
        for (var group : groups.stream().limit(1000).toList()) {
            var parsed = GroupFormatEngine.parse(policy, group.getValue());
            if (parsed.valid()) { attach(group.getKey(), parsed, true); matched++; }
            else jdbc.sql("update org.study_groups set format_revision=:revision where id=:id")
                    .param("revision", expectedRevision).param("id", group.getKey()).update();
        }
        return new ReconcileResult(matched, Math.min(groups.size(), 1000) - matched, groups.size() > 1000);
    }

    private void admin(AuthenticatedUser actor) {
        if (actor == null || actor.role() != PersonRole.ADMIN) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Только администратор настраивает формат групп");
        }
    }

    private List<GroupFormatPolicy.Field> fields(String source) {
        try { return json.readValue(source, new TypeReference<>() {}); }
        catch (java.io.IOException error) { throw new IllegalStateException("Invalid stored group format", error); }
    }

    private String encode(Object value) {
        try { return json.writeValueAsString(value); }
        catch (java.io.IOException error) { throw new IllegalStateException(error); }
    }

    public record ReconcileResult(int matched, int unrecognized, boolean hasMore) {}
}
