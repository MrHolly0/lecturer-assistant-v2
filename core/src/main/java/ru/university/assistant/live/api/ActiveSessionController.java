package ru.university.assistant.live.api;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.internal.LiveSessionService;

/** B-03: вход в мини-приложение сразу в идущую лекцию, без выбора курса вручную. */
@RestController
class ActiveSessionController {
    private final LiveSessionService liveSessions;

    ActiveSessionController(LiveSessionService liveSessions) {
        this.liveSessions = liveSessions;
    }

    @GetMapping("/api/v1/me/active-session")
    public ResponseEntity<ActiveSessionSummary> activeSession(@AuthenticationPrincipal AuthenticatedUser user) {
        return liveSessions
                .activeSessionFor(user)
                .map(ActiveSessionSummary::of)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }
}
