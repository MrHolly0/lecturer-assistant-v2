package ru.university.assistant.channel.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ChannelInternalControllerTest {
    private final FakeChannels channels = new FakeChannels();
    private final ChannelInternalController controller = new ChannelInternalController(channels, "secret");

    @Test
    void rejectsInvalidInternalApiKey() {
        ChannelCapabilities capabilities = new ChannelCapabilities(true, true, true, 4096, 4);

        ResponseStatusException error = assertThrows(
                ResponseStatusException.class,
                () -> controller.registerCapabilities("echo", "wrong", capabilities));

        assertEquals(401, error.getStatusCode().value());
    }

    @Test
    void pollsOutboxWithBoundedBatchLimit() {
        controller.pollOutbox("echo", "secret", "1s", 500);

        assertEquals("echo", channels.channelType);
        assertEquals(Duration.ofSeconds(1), channels.wait);
        assertEquals(100, channels.limit);
    }

    @Test
    void acceptsInboundWithValidKey() {
        InboundEvent event = new InboundEvent("chat-1", InboundKind.COMMAND, "/help", "Echo User", Instant.now());

        controller.inbound("echo", "secret", event);

        assertEquals("echo", channels.channelType);
        assertEquals(event, channels.event);
    }

    private static class FakeChannels implements ChannelInternalApi {
        private String channelType;
        private Duration wait;
        private int limit;
        private InboundEvent event;

        @Override
        public void registerCapabilities(String channelType, ChannelCapabilities capabilities) {
            this.channelType = channelType;
        }

        @Override
        public OutboxBatch poll(String channelType, Duration wait, int limit) {
            this.channelType = channelType;
            this.wait = wait;
            this.limit = limit;
            return new OutboxBatch(List.of());
        }

        @Override
        public void report(String channelType, DeliveryReportBatch batch) {
            this.channelType = channelType;
        }

        @Override
        public void handleInbound(String channelType, InboundEvent event) {
            this.channelType = channelType;
            this.event = event;
        }
    }
}
