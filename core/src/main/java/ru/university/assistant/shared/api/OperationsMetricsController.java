package ru.university.assistant.shared.api;

import io.micrometer.core.instrument.Meter;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Private operator snapshot. No registry-wide export and no person/session/course labels. */
@RestController
public class OperationsMetricsController {
    private static final List<String> PREFIXES = List.of("live.sse.", "live.student.", "projection.",
            "api.admission.", "api.analytics.", "content.import.", "channel.outbox.", "analytics.summary",
            "hikaricp.connections", "jvm.memory.", "jvm.gc.", "process.cpu.", "http.server.requests");
    private final MeterRegistry meters;
    private final String apiKey;
    public OperationsMetricsController(MeterRegistry meters, @Value("${app.channel.internal-api-key}") String apiKey) {
        this.meters = meters; this.apiKey = apiKey;
    }
    @GetMapping("/internal/v1/operations/metrics")
    public Map<String, Object> snapshot(@RequestHeader(value = "X-Internal-Api-Key", required = false) String key) {
        if (key == null || !MessageDigest.isEqual(apiKey.getBytes(StandardCharsets.UTF_8),
                key.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal key is required");
        }
        List<Metric> values = meters.getMeters().stream()
                .filter(meter -> PREFIXES.stream().anyMatch(meter.getId().getName()::startsWith))
                .map(meter -> new Metric(meter.getId().getName(), safeTags(meter), measurements(meter)))
                .toList();
        return Map.of("metrics", values, "scope", "this-process");
    }
    private Map<String, String> safeTags(Meter meter) {
        return meter.getId().getTags().stream()
                .filter(tag -> List.of("reason", "result", "state", "area", "action", "cause", "pool",
                        "status", "method", "outcome", "exception").contains(tag.getKey()))
                .collect(java.util.stream.Collectors.toMap(tag -> tag.getKey(), tag -> tag.getValue(), (a, b) -> a));
    }
    private Map<String, Double> measurements(Meter meter) {
        Map<String, Double> values = new java.util.LinkedHashMap<>();
        meter.measure().forEach(item -> {
            double value = item.getValue();
            if (Double.isFinite(value)) values.put(item.getStatistic().getTagValueRepresentation(), value);
        });
        return values;
    }
    public record Metric(String name, Map<String, String> tags, Map<String, Double> measurements) {}
}
