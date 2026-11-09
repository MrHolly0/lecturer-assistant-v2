package ru.university.assistant.projection.internal;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
@ConditionalOnProperty(name = "app.media.provider", havingValue = "sfu")
public class SfuTicketClient {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(SfuTicketClient.class);
    private final RestClient client;
    SfuTicketClient(RestClient.Builder builder, @Value("${app.media.service-url}") String url,
            @Value("${app.services.media-key}") String key) {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(2)).build());
        factory.setReadTimeout(Duration.ofSeconds(3));
        client = builder.baseUrl(url).requestFactory(factory).defaultHeader("X-Service-Key", key).build();
    }
    public Object ticket(UUID grantId) {
        try {
            return client.post().uri("/internal/v1/media/ticket").body(Map.of("grantId", grantId))
                    .retrieve().body(Map.class);
        } catch (org.springframework.web.client.RestClientException unavailable) {
            LOG.warn("Media ticket RPC unavailable ({})", unavailable instanceof
                    org.springframework.web.client.RestClientResponseException response
                    ? response.getStatusCode().value() : unavailable.getClass().getSimpleName());
            throw new ru.university.assistant.shared.api.CapacityUnavailableException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "Media service unavailable", 2);
        }
    }
}
