package ru.university.assistant.channel.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import ru.university.assistant.channel.api.ChannelCapabilities;
import ru.university.assistant.channel.api.DeliveryReport;
import ru.university.assistant.channel.api.DeliveryStatus;
import ru.university.assistant.channel.api.OutboundButton;
import ru.university.assistant.channel.api.OutboundContent;
import ru.university.assistant.channel.api.OutboundMessage;
import ru.university.assistant.channel.api.OutboundPriority;
import ru.university.assistant.channel.api.ReplyMode;

@Repository
class ChannelRepository {
    private static final TypeReference<List<List<OutboundButton>>> KEYBOARD_TYPE = new TypeReference<>() {};

    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    ChannelRepository(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    void saveCapabilities(String channelType, ChannelCapabilities capabilities) {
        jdbc.sql(
                        """
                        insert into channel.channel_capabilities
                            (channel_type, inline_buttons, edit_message, images, max_text_length, max_buttons_per_row)
                        values (:channelType, :inlineButtons, :editMessage, :images, :maxTextLength, :maxButtonsPerRow)
                        on conflict (channel_type) do update set
                            inline_buttons = excluded.inline_buttons,
                            edit_message = excluded.edit_message,
                            images = excluded.images,
                            max_text_length = excluded.max_text_length,
                            max_buttons_per_row = excluded.max_buttons_per_row,
                            updated_at = now()
                        """)
                .param("channelType", channelType)
                .param("inlineButtons", capabilities.inlineButtons())
                .param("editMessage", capabilities.editMessage())
                .param("images", capabilities.images())
                .param("maxTextLength", capabilities.maxTextLength())
                .param("maxButtonsPerRow", capabilities.maxButtonsPerRow())
                .update();
    }

    void enqueue(String channelType, OutboundMessage message) {
        jdbc.sql(
                        """
                        insert into channel.outbox (
                            id, channel_type, channel_identity_id, priority, content, keyboard, reply_mode,
                            thread_key, status
                        )
                        values (
                            :id, :channelType, :identityId, :priority, cast(:content as jsonb),
                            cast(:keyboard as jsonb), :replyMode, :threadKey, 'QUEUED'
                        )
                        on conflict (id) do nothing
                        """)
                .param("id", message.id())
                .param("channelType", channelType)
                .param("identityId", message.channelIdentityId())
                .param("priority", message.priority().name())
                .param("content", json(message.content()))
                .param("keyboard", json(message.keyboard()))
                .param("replyMode", message.replyMode().name())
                .param("threadKey", message.threadKey())
                .update();
    }

    List<OutboundMessage> claim(String channelType, int limit, int lockSeconds) {
        return jdbc.sql(
                        """
                        with claimed as (
                            select id
                            from channel.outbox
                            where channel_type = :channelType
                                and status in ('QUEUED', 'FAILED')
                                and next_attempt_at <= now()
                            order by
                                case priority
                                    when 'P0_INTERACTIVE' then 0
                                    when 'P1_ACTIVITY' then 1
                                    when 'P2_SLIDE' then 2
                                    else 3
                                end,
                                created_at
                            limit :limit
                            for update skip locked
                        ),
                        updated as (
                            update channel.outbox o
                            set status = 'IN_FLIGHT',
                                attempts = attempts + 1,
                                locked_until = now() + (:lockSeconds * interval '1 second'),
                                updated_at = now()
                            where o.id in (select id from claimed)
                            returning id, channel_identity_id, priority, content, keyboard, reply_mode, thread_key
                        )
                        select u.id, u.channel_identity_id, ci.external_id, u.priority, u.content, u.keyboard,
                            u.reply_mode, u.thread_key
                        from updated u
                        join iam.channel_identities ci on ci.id = u.channel_identity_id
                        """)
                .param("channelType", channelType)
                .param("limit", limit)
                .param("lockSeconds", lockSeconds)
                .query(this::mapMessage)
                .list();
    }

    int requeueExpiredInFlight() {
        return jdbc.sql(
                        """
                        update channel.outbox
                        set status = case when attempts >= max_attempts then 'DLQ' else 'QUEUED' end,
                            next_attempt_at = now() + (power(2, attempts) * interval '1 second'),
                            last_error = 'adapter lock expired',
                            updated_at = now()
                        where status = 'IN_FLIGHT'
                            and locked_until is not null
                            and locked_until < now()
                        """)
                .update();
    }

    void saveReport(String channelType, DeliveryReport report) {
        jdbc.sql(
                        """
                        insert into channel.delivery_reports (
                            id, outbox_id, channel_type, status, adapter_message_id, error_message, latency_ms
                        )
                        values (:id, :outboxId, :channelType, :status, :adapterMessageId, :errorMessage, :latencyMs)
                        """)
                .param("id", ru.university.assistant.shared.api.UuidV7.generate())
                .param("outboxId", report.messageId())
                .param("channelType", channelType)
                .param("status", report.status().name())
                .param("adapterMessageId", report.adapterMessageId())
                .param("errorMessage", report.errorMessage())
                .param("latencyMs", report.latencyMs())
                .update();
        if (report.status() == DeliveryStatus.DELIVERED) {
            markDelivered(report);
        } else {
            markFailed(report);
        }
    }

    List<Recipient> recipientsForSession(UUID sessionId) {
        return jdbc.sql(
                        """
                        select ci.id, ci.channel_type
                        from live.session_participants sp
                        join iam.channel_identities ci
                            on ci.person_id = sp.person_id and ci.channel_type = sp.channel_type
                        where sp.session_id = :sessionId
                            and sp.left_at is null
                            and sp.kicked = false
                        """)
                .param("sessionId", sessionId)
                .query((rs, row) -> new Recipient(rs.getObject("id", UUID.class), rs.getString("channel_type")))
                .list();
    }

    private void markDelivered(DeliveryReport report) {
        jdbc.sql(
                        """
                        update channel.outbox
                        set status = 'DELIVERED',
                            adapter_message_id = :adapterMessageId,
                            delivered_at = now(),
                            updated_at = now()
                        where id = :id
                        """)
                .param("id", report.messageId())
                .param("adapterMessageId", report.adapterMessageId())
                .update();
    }

    private void markFailed(DeliveryReport report) {
        jdbc.sql(
                        """
                        update channel.outbox
                        set status = case when attempts >= max_attempts then 'DLQ' else 'QUEUED' end,
                            next_attempt_at = now() + (power(2, attempts) * interval '1 second'),
                            last_error = :error,
                            updated_at = now()
                        where id = :id
                        """)
                .param("id", report.messageId())
                .param("error", report.errorMessage())
                .update();
    }

    private OutboundMessage mapMessage(ResultSet rs, int rowNumber) throws SQLException {
        return new OutboundMessage(
                rs.getObject("id", UUID.class),
                rs.getObject("channel_identity_id", UUID.class),
                rs.getString("external_id"),
                OutboundPriority.valueOf(rs.getString("priority")),
                readContent(rs.getString("content")),
                readKeyboard(rs.getString("keyboard")),
                ReplyMode.valueOf(rs.getString("reply_mode")),
                rs.getString("thread_key"));
    }

    private OutboundContent readContent(String json) {
        try {
            return objectMapper.readValue(json, OutboundContent.class);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot read outbound content", exception);
        }
    }

    private List<List<OutboundButton>> readKeyboard(String json) {
        try {
            return objectMapper.readValue(json, KEYBOARD_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Cannot read outbound keyboard", exception);
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Cannot write outbound JSON", exception);
        }
    }

    record Recipient(UUID channelIdentityId, String channelType) {}
}
