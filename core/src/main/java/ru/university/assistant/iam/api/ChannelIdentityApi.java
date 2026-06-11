package ru.university.assistant.iam.api;

import java.util.Optional;

public interface ChannelIdentityApi {
    Optional<ChannelIdentityResponse> findByExternalId(String channelType, String externalId);
}
