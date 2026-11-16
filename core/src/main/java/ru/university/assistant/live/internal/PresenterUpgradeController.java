package ru.university.assistant.live.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.org.api.CourseAccessApi;

/** A short transport-only credential; STOMP still obtains a fresh permission grant. */
@RestController
class PresenterUpgradeController {
    private final LiveSessionService sessions;
    private final CourseAccessApi access;
    private final ObjectMapper json;
    private final Clock clock;
    private final String key;
    private final boolean legacy;

    PresenterUpgradeController(
            LiveSessionService sessions,
            CourseAccessApi access,
            ObjectMapper json,
            Clock clock,
            @Value("${app.services.realtime-key:}") String key,
            @Value("${app.live.legacy-transports-enabled:true}") boolean legacy) {
        this.sessions = sessions;
        this.access = access;
        this.json = json;
        this.clock = clock;
        this.key = key;
        this.legacy = legacy;
    }

    @PostMapping("/api/v1/sessions/{sessionId}/realtime-ticket")
    Map<String, Object> ticket(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID sessionId)
            throws java.security.GeneralSecurityException, java.io.IOException {
        var session = sessions.requireSession(sessionId);
        access.requireManage(user, session.courseId());
        if (legacy) return Map.of("transport", "legacy");
        if (key.length() < 32) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
        long expires = clock.millis() + 20000;
        String payload =
                Base64.getUrlEncoder()
                        .withoutPadding()
                        .encodeToString(
                                json.writeValueAsBytes(
                                        Map.of(
                                                "v",
                                                1,
                                                "session",
                                                sessionId,
                                                "person",
                                                user.id(),
                                                "nonce",
                                                UUID.randomUUID(),
                                                "expires",
                                                expires)));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String signature =
                Base64.getUrlEncoder()
                        .withoutPadding()
                        .encodeToString(
                                mac.doFinal(
                                        ("presenter-upgrade-v1." + payload)
                                                .getBytes(StandardCharsets.UTF_8)));
        return Map.of(
                "transport", "ticket", "ticket", payload + "." + signature, "expiresAt", expires);
    }
}
