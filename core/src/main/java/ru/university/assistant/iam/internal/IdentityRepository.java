package ru.university.assistant.iam.internal;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.iam.api.ChannelIdentityResponse;

@Repository
class IdentityRepository {
    private final JdbcClient jdbc;

    IdentityRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void createLinkCode(UUID id, UUID personId, String code, Instant expiresAt) {
        jdbc.sql(
                        """
                        insert into iam.identity_link_codes (id, person_id, code, expires_at)
                        values (:id, :personId, :code, :expiresAt)
                        """)
                .param("id", id)
                .param("personId", personId)
                .param("code", code)
                .param("expiresAt", Timestamp.from(expiresAt))
                .update();
    }

    Optional<UUID> findUsablePersonIdByCode(String code) {
        return jdbc.sql(
                        """
                        select person_id
                        from iam.identity_link_codes
                        where code = :code and used_at is null and expires_at > now()
                        """)
                .param("code", code)
                .query(UUID.class)
                .optional();
    }

    void markLinkCodeUsed(String code) {
        jdbc.sql("update iam.identity_link_codes set used_at = now() where code = :code")
                .param("code", code)
                .update();
    }

    /** Сериализует первый вход одного внешнего пользователя, чтобы параллельные запросы не создали двух людей. */
    void lockExternalId(String channelType, String externalId) {
        jdbc.sql("select pg_advisory_xact_lock(hashtextextended(:key, 0))")
                .param("key", channelType + ":" + externalId)
                .query()
                .singleRow();
    }

    ChannelIdentityResponse createIdentity(
            UUID id, UUID personId, String channelType, String externalId, String displayHint) {
        return jdbc.sql(
                        """
                        insert into iam.channel_identities
                            (id, person_id, channel_type, external_id, display_hint)
                        values (:id, :personId, :channelType, :externalId, :displayHint)
                        returning id, person_id, channel_type, external_id, display_hint, linked_at
                        """)
                .param("id", id)
                .param("personId", personId)
                .param("channelType", channelType)
                .param("externalId", externalId)
                .param("displayHint", displayHint)
                .query(this::mapIdentity)
                .single();
    }

    boolean existsForPerson(UUID personId, String channelType) {
        return jdbc.sql("select exists(select 1 from iam.channel_identities "
                        + "where person_id = :personId and channel_type = :channelType)")
                .param("personId", personId)
                .param("channelType", channelType)
                .query(Boolean.class)
                .single();
    }

    Optional<ChannelIdentityResponse> findByExternalId(String channelType, String externalId) {
        return jdbc.sql(
                        """
                        select id, person_id, channel_type, external_id, display_hint, linked_at
                        from iam.channel_identities
                        where channel_type = :channelType and external_id = :externalId
                        """)
                .param("channelType", channelType)
                .param("externalId", externalId)
                .query(this::mapIdentity)
                .optional();
    }

    private ChannelIdentityResponse mapIdentity(ResultSet resultSet, int rowNumber) throws SQLException {
        return new ChannelIdentityResponse(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("person_id", UUID.class),
                resultSet.getString("channel_type"),
                resultSet.getString("external_id"),
                resultSet.getString("display_hint"),
                resultSet.getTimestamp("linked_at").toInstant());
    }
}
