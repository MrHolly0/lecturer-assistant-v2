package ru.university.assistant.channel.api;

import java.time.Duration;

public interface ChannelInternalApi {
    void registerCapabilities(String channelType, ChannelCapabilities capabilities);

    OutboxBatch poll(String channelType, Duration wait, int limit);

    void report(String channelType, DeliveryReportBatch batch);

    void handleInbound(String channelType, InboundEvent event);
}
