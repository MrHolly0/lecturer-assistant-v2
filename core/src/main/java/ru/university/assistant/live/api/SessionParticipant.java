package ru.university.assistant.live.api;

import java.time.Instant;
import java.util.UUID;

public record SessionParticipant(
        UUID sessionId,
        UUID personId,
        String channelType,
        String displayName,
        Instant joinedAt,
        Instant leftAt,
        boolean kicked) {}
