package ru.university.assistant.live.api;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.internal.LiveSessionService;
import ru.university.assistant.live.internal.SessionHistoryService;

@RestController
@RequestMapping("/api/v1/courses/{courseId}")
public class LiveSessionController {
    private final LiveSessionService liveSessions;
    private final SessionHistoryService sessionHistory;

    LiveSessionController(LiveSessionService liveSessions, SessionHistoryService sessionHistory) {
        this.liveSessions = liveSessions;
        this.sessionHistory = sessionHistory;
    }

    @PostMapping("/lectures/{lectureId}/sessions")
    @ResponseStatus(HttpStatus.CREATED)
    public LiveSession create(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID lectureId,
            @Valid @RequestBody StartSessionRequest request) {
        return liveSessions.schedule(user, courseId, lectureId, request);
    }

    @PostMapping("/sessions/{sessionId}/begin")
    public LiveSession begin(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        return liveSessions.begin(user, courseId, sessionId);
    }

    @GetMapping("/sessions/{sessionId}")
    public LiveSession get(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        return liveSessions.get(user, courseId, sessionId);
    }

    @GetMapping("/sessions")
    public SessionHistoryPage history(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        return sessionHistory.list(user, courseId, limit, offset);
    }

    @GetMapping("/sessions/{sessionId}/participants")
    public List<SessionParticipant> participants(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        return liveSessions.participants(user, courseId, sessionId);
    }

    @PostMapping("/sessions/join")
    public LiveSession join(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @Valid @RequestBody JoinSessionRequest request) {
        return liveSessions.join(user, courseId, request);
    }

    @PutMapping("/sessions/{sessionId}/slide")
    public LiveSession changeSlide(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @Valid @RequestBody ChangeSlideRequest request) {
        return liveSessions.changeSlide(user, courseId, sessionId, request);
    }

    @PutMapping("/sessions/{sessionId}/annotations")
    public LiveSession saveAnnotations(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @Valid @RequestBody SaveAnnotationsRequest request) {
        return liveSessions.saveAnnotations(user, courseId, sessionId, request);
    }

    @PostMapping("/sessions/{sessionId}/pause")
    public LiveSession pause(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        return liveSessions.transition(user, courseId, sessionId, SessionStatus.PAUSED);
    }

    @PostMapping("/sessions/{sessionId}/resume")
    public LiveSession resume(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        return liveSessions.transition(user, courseId, sessionId, SessionStatus.LIVE);
    }

    @PostMapping("/sessions/{sessionId}/end")
    public LiveSession end(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        return liveSessions.transition(user, courseId, sessionId, SessionStatus.ENDED);
    }
}
