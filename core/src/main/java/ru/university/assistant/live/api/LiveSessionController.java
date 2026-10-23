package ru.university.assistant.live.api;

import jakarta.validation.Valid;
import java.time.Instant;
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
import org.springframework.web.bind.annotation.RequestHeader;
import ru.university.assistant.shared.api.CommandIdempotency;
import ru.university.assistant.org.api.CourseAccessApi;
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
    private final CommandIdempotency commands;
    private final CourseAccessApi access;

    LiveSessionController(LiveSessionService liveSessions, SessionHistoryService sessionHistory,
            CommandIdempotency commands, CourseAccessApi access) {
        this.liveSessions = liveSessions;
        this.sessionHistory = sessionHistory;
        this.commands = commands;
        this.access = access;
    }

    @PostMapping("/lectures/{lectureId}/sessions")
    @ResponseStatus(HttpStatus.CREATED)
    public LiveSession create(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID lectureId,
            @Valid @RequestBody StartSessionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        access.requireManage(user, courseId);
        return commands.execute(user.id(), "POST /courses/" + courseId + "/lectures/" + lectureId + "/sessions",
                key, commands.hash(request), LiveSession.class,
                () -> liveSessions.schedule(user, courseId, lectureId, request));
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
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) UUID groupId,
            @RequestParam(required = false) Instant endedFrom,
            @RequestParam(required = false) Instant endedBefore) {
        return sessionHistory.list(user, courseId, limit, offset, query, groupId, endedFrom, endedBefore);
    }

    @GetMapping("/sessions/{sessionId}/participants")
    public List<SessionParticipant> participants(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        return liveSessions.participants(user, courseId, sessionId);
    }

    @PostMapping("/sessions/{sessionId}/participants/{personId}/kick")
    public SessionParticipant kickParticipant(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId, @PathVariable UUID sessionId, @PathVariable UUID personId) {
        return liveSessions.kickParticipant(user, courseId, sessionId, personId);
    }

    @PostMapping("/sessions/{sessionId}/participants/{personId}/request-name")
    public SessionParticipant requestParticipantName(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId, @PathVariable UUID sessionId, @PathVariable UUID personId) {
        return liveSessions.requestParticipantName(user, courseId, sessionId, personId);
    }

    @PostMapping("/sessions/join")
    public LiveSession join(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @Valid @RequestBody JoinSessionRequest request) {
        return liveSessions.join(user, courseId, request);
    }

    public record ProjectionRequest(boolean showJoinCode) {}

    @PutMapping("/sessions/{sessionId}/projection")
    public LiveSession projection(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId, @PathVariable UUID sessionId,
            @RequestBody ProjectionRequest request) {
        return liveSessions.setProjection(user, courseId, sessionId, request.showJoinCode());
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
