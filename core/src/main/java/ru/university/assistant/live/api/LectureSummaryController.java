package ru.university.assistant.live.api;

import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.internal.LectureSummaryService;

@RestController
@RequestMapping("/api/v1/courses/{courseId}/sessions/{sessionId}/summary")
class LectureSummaryController {
    private final LectureSummaryService summaries;

    LectureSummaryController(LectureSummaryService summaries) {
        this.summaries = summaries;
    }

    @GetMapping
    public LectureSummary get(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        return summaries.get(user, courseId, sessionId);
    }
}
