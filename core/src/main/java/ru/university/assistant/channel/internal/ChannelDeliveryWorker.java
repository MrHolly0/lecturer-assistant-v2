package ru.university.assistant.channel.internal;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class ChannelDeliveryWorker {
    private final ChannelRepository channels;

    ChannelDeliveryWorker(ChannelRepository channels) {
        this.channels = channels;
    }

    @Scheduled(fixedDelayString = "${app.channel.delivery-worker-delay-ms:5000}")
    @Transactional
    void requeueExpiredMessages() {
        channels.requeueExpiredInFlight();
    }
}
