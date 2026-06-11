package ru.university.assistant.channel.api;

import java.util.List;
import java.util.UUID;

public record OutboundMessage(
        UUID id,
        UUID channelIdentityId,
        String externalUserId,
        OutboundPriority priority,
        OutboundContent content,
        List<List<OutboundButton>> keyboard,
        ReplyMode replyMode,
        String threadKey) {}
