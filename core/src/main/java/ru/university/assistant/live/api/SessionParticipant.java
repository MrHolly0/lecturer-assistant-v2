package ru.university.assistant.live.api;

import java.time.Instant;
import java.util.UUID;

public record SessionParticipant(
        UUID sessionId,
        UUID personId,
        String channelType,
        String displayName,
        UUID groupId,
        String groupName,
        Instant joinedAt,
        Instant leftAt,
        boolean kicked,
        Instant nameRequestedAt,
        Instant nameSubmittedAt) {}
