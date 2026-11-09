package ru.university.assistant.integration.internal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.shared.api.ServiceAuthentication;
import ru.university.assistant.integration.internal.IntegrationOutbox.Ack;

@RestController
class IntegrationController {
    private final IntegrationOutbox outbox;
    private final ServiceAuthentication authentication;

    IntegrationController(IntegrationOutbox outbox, ServiceAuthentication authentication) {
        this.outbox = outbox;
        this.authentication = authentication;
    }

    @PostMapping("/internal/v1/events/outbox/claim")
    Map<String, Object> claim(@RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody ClaimRequest request) {
        authentication.require("events", key);
        return Map.of("items", outbox.claim(request.owner(), request.limit(), request.leaseSeconds()));
    }

    @PostMapping("/internal/v1/events/outbox/ack")
    Map<String, Object> ack(@RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody AckRequest request) {
        authentication.require("events", key);
        return Map.of("changed", outbox.acknowledge(request.items()));
    }

    record ClaimRequest(@NotNull UUID owner, @Min(1) @Max(256) int limit,
            @Min(15) @Max(120) int leaseSeconds) {}
    record AckRequest(@NotNull @Size(max = 256) List<@NotNull @Valid Ack> items) {}

    @PostMapping("/internal/v1/events/outbox/status")
    Object status(@RequestHeader(value = "X-Service-Key", required = false) String key) {
        authentication.require("events", key);
        return outbox.status();
    }

    @PostMapping("/internal/v1/events/outbox/redrive")
    Object redrive(@RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody RedriveRequest request) {
        authentication.require("events", key);
        return Map.of("changed", outbox.redrive(request.ids()));
    }
    record RedriveRequest(@NotNull @Size(max = 256) List<@NotNull UUID> ids) {}
}
