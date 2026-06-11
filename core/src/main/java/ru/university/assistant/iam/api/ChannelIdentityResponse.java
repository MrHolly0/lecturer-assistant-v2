package ru.university.assistant.iam.api;

import java.time.Instant;
import java.util.UUID;

public record ChannelIdentityResponse(
        UUID id, UUID personId, String channelType, String externalId, String displayHint, Instant linkedAt) {}
