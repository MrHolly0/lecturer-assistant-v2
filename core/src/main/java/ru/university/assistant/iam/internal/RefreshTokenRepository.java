package ru.university.assistant.iam.internal;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class RefreshTokenRepository {
    private final JdbcClient jdbc;

    RefreshTokenRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void create(UUID id, UUID personId, String tokenHash, Instant expiresAt) {
        jdbc.sql(
                        """
                        insert into iam.refresh_tokens (id, person_id, token_hash, expires_at)
                        values (:id, :personId, :tokenHash, :expiresAt)
                        """)
                .param("id", id)
                .param("personId", personId)
                .param("tokenHash", tokenHash)
                .param("expiresAt", Timestamp.from(expiresAt))
                .update();
    }

    Optional<UUID> findUsablePersonId(String tokenHash) {
        return jdbc.sql(
                        """
                        select person_id
                        from iam.refresh_tokens
                        where token_hash = :tokenHash and revoked_at is null and expires_at > now()
                        """)
                .param("tokenHash", tokenHash)
                .query(UUID.class)
                .optional();
    }

    void revoke(String tokenHash) {
        jdbc.sql("update iam.refresh_tokens set revoked_at = now() where token_hash = :tokenHash")
                .param("tokenHash", tokenHash)
                .update();
    }
}
