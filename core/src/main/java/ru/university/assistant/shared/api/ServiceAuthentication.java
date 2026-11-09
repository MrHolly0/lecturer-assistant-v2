package ru.university.assistant.shared.api;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Internal services have separate credentials and no implicit user privileges. */
@Component
public class ServiceAuthentication {
    private final Map<String, String> keys;

    public ServiceAuthentication(
            @Value("${app.services.events-key:}") String events,
            @Value("${app.services.realtime-key:}") String realtime,
            @Value("${app.services.analytics-key:}") String analytics,
            @Value("${app.services.content-key:}") String content,
            @Value("${app.services.media-key:}") String media) {
        keys = Map.of("events", events, "realtime", realtime, "analytics", analytics,
                "content", content, "media", media);
    }

    public void require(String service, String presented) {
        String expected = keys.getOrDefault(service, "");
        if (expected.length() < 32 || presented == null || !MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), presented.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid service credential");
        }
    }
}
