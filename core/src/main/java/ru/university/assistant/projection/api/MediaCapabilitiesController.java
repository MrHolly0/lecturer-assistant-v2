package ru.university.assistant.projection.api;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class MediaCapabilitiesController {
    private final String provider;
    MediaCapabilitiesController(@Value("${app.media.provider:legacy}") String provider) {
        if (!java.util.Set.of("legacy", "sfu").contains(provider))
            throw new IllegalArgumentException("MEDIA_PROVIDER must be legacy or sfu");
        this.provider = provider;
    }
    @GetMapping("/api/v1/media/capabilities")
    Map<String, String> capabilities() { return Map.of("provider", provider); }
}
