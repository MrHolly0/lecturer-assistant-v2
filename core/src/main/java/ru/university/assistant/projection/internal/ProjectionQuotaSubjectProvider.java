package ru.university.assistant.projection.internal;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import ru.university.assistant.iam.api.CredentialQuotaSubjectApi;

/** Minimal indexed lookup for accounting. The media handler still checks current policy/owner/scope. */
@Component
class ProjectionQuotaSubjectProvider implements CredentialQuotaSubjectApi {
    private static final Pattern PATH = Pattern.compile("^/api/v1/projection/agent/view/sessions/([^/]+)(?:/.*)?$");
    private final JdbcClient jdbc;
    private final Clock clock;
    ProjectionQuotaSubjectProvider(JdbcClient jdbc, Clock clock) { this.jdbc = jdbc; this.clock = clock; }
    @Override public String headerName() { return "X-Projection-View-Token"; }
    @Override public boolean supports(String path) { return PATH.matcher(path).matches(); }
    @Override public Optional<String> findSubject(String path, String credential) {
        if (!credential.matches("[a-f0-9]{64}")) return Optional.empty();
        return jdbc.sql("""
                select d.id from projection.commands c join projection.devices d on d.id = c.device_id
                where c.view_token_hash = :hash and c.type = 'START_PUBLIC_PROJECTION'
                    and c.view_token_expires_at > :now and d.active_command_id = c.id
                    and d.active_session_id = c.session_id and d.active_course_id = c.course_id
                    and d.active_until > :now and d.revoked_at is null
                """).param("hash", digest(credential)).param("now", clock.instant().atOffset(ZoneOffset.UTC))
                .query(UUID.class).optional().map(id -> "projection:" + id);
    }
    private String digest(String credential) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(credential.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
