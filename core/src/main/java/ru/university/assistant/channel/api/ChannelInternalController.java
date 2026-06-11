package ru.university.assistant.channel.api;

import jakarta.validation.Valid;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/internal/v1/channels/{channelType}")
public class ChannelInternalController {
    private final ChannelInternalApi channels;
    private final String apiKey;

    ChannelInternalController(
            ChannelInternalApi channels,
            @Value("${app.channel.internal-api-key}") String apiKey) {
        this.channels = channels;
        this.apiKey = apiKey;
    }

    @PutMapping("/capabilities")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void registerCapabilities(
            @PathVariable String channelType,
            @RequestHeader("X-Internal-Api-Key") String key,
            @Valid @RequestBody ChannelCapabilities capabilities) {
        requireKey(key);
        channels.registerCapabilities(channelType, capabilities);
    }

    @GetMapping("/outbox")
    public OutboxBatch pollOutbox(
            @PathVariable String channelType,
            @RequestHeader("X-Internal-Api-Key") String key,
            @RequestParam(defaultValue = "25s") String wait,
            @RequestParam(defaultValue = "100") int limit) {
        requireKey(key);
        return channels.poll(channelType, parseWait(wait), Math.min(Math.max(limit, 1), 100));
    }

    @PostMapping("/delivery-reports")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void reportDelivery(
            @PathVariable String channelType,
            @RequestHeader("X-Internal-Api-Key") String key,
            @Valid @RequestBody DeliveryReportBatch batch) {
        requireKey(key);
        channels.report(channelType, batch);
    }

    @PostMapping("/inbound")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void inbound(
            @PathVariable String channelType,
            @RequestHeader("X-Internal-Api-Key") String key,
            @Valid @RequestBody InboundEvent event) {
        requireKey(key);
        channels.handleInbound(channelType, event);
    }

    private void requireKey(String key) {
        if (!apiKey.equals(key)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid internal API key");
        }
    }

    private Duration parseWait(String value) {
        if (value.endsWith("s")) {
            return Duration.ofSeconds(Long.parseLong(value.substring(0, value.length() - 1)));
        }
        return Duration.parse(value);
    }
}
