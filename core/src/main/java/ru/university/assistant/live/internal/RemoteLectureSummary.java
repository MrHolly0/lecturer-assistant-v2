package ru.university.assistant.live.internal;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import ru.university.assistant.live.api.LectureSummary;
import ru.university.assistant.shared.api.CapacityUnavailableException;

/** The public endpoint still authorizes in the authority before reading the isolated projection. */
@Component
class RemoteLectureSummary {
    private final RestClient client;

    RemoteLectureSummary(RestClient.Builder builder,
            @Value("${app.analytics.service-url:}") String url,
            @Value("${app.services.analytics-key:}") String key) {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(2)).build());
        factory.setReadTimeout(Duration.ofSeconds(3));
        client = url.isBlank() ? null : builder.baseUrl(url).requestFactory(factory)
                .defaultHeader("X-Service-Key", key).build();
    }

    boolean enabled() { return client != null; }

    LectureSummary get(UUID session, String fingerprint) {
        try {
            return client.post().uri("/internal/v1/analytics/reports")
                    .body(Map.of("sessionId", session, "fingerprint", fingerprint))
                    .exchange((request, response) -> {
                        if (response.getStatusCode().value() != 200) throw pending();
                        return response.bodyTo(LectureSummary.class);
                    });
        } catch (org.springframework.web.client.RestClientException unavailable) { throw pending(); }
    }

    private static CapacityUnavailableException pending() {
        return new CapacityUnavailableException(HttpStatus.SERVICE_UNAVAILABLE,
                "Analytics projection is being prepared", 2);
    }
}
