package ru.university.assistant.live.api;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.live.internal.PreparedLectureSummary;

@RestController
public class LectureSummaryOperationsController {
    private final PreparedLectureSummary summaries;
    private final String apiKey;
    LectureSummaryOperationsController(PreparedLectureSummary summaries,
            @Value("${app.channel.internal-api-key}") String apiKey) {
        this.summaries = summaries; this.apiKey = apiKey;
    }
    /** Drop only the derived row; the next authorized summary read rebuilds it from source tables. */
    @DeleteMapping("/internal/v1/operations/lecture-summaries/{sessionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void rebuild(@PathVariable UUID sessionId,
            @RequestHeader(value = "X-Internal-Api-Key", required = false) String key) {
        if (key == null || !MessageDigest.isEqual(apiKey.getBytes(StandardCharsets.UTF_8),
                key.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Internal key is required");
        }
        summaries.invalidate(sessionId);
    }
}
