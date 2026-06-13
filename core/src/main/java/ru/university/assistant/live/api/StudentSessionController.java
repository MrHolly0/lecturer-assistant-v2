package ru.university.assistant.live.api;

import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.internal.StudentSseBroadcaster;
import ru.university.assistant.live.internal.StudentWebSessionService;
import ru.university.assistant.qa.api.StudentQuestion;

@RestController
class StudentSessionController {
    private final StudentWebSessionService studentSessions;
    private final StudentSseBroadcaster broadcaster;

    StudentSessionController(StudentWebSessionService studentSessions, StudentSseBroadcaster broadcaster) {
        this.studentSessions = studentSessions;
        this.broadcaster = broadcaster;
    }

    @GetMapping("/api/v1/courses/{courseId}/sessions/{sessionId}/engagement")
    public StudentEngagement engagement(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        return studentSessions.engagement(user, courseId, sessionId);
    }

    @GetMapping("/api/v1/student/sessions/{joinCode}")
    public StudentSessionSnapshot snapshot(@PathVariable String joinCode) {
        return studentSessions.snapshot(joinCode);
    }

    @PostMapping("/api/v1/student/sessions/{joinCode}/join")
    public StudentJoinResponse join(
            @PathVariable String joinCode,
            @Valid @RequestBody(required = false) StudentJoinRequest request) {
        return studentSessions.join(joinCode, request);
    }

    @GetMapping(path = "/api/v1/student/sessions/{joinCode}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@PathVariable String joinCode, @RequestParam String participantToken) {
        studentSessions.tokenBelongsToJoinCode(joinCode, participantToken);
        SseEmitter emitter = new SseEmitter(30 * 60 * 1000L);
        broadcaster.register(joinCode, emitter);
        return emitter;
    }

    @PostMapping("/api/v1/student/sessions/{joinCode}/signals")
    public SignalAggregate signal(
            @PathVariable String joinCode,
            @Valid @RequestBody StudentSignalRequest request) {
        return studentSessions.signal(joinCode, request);
    }

    @PostMapping("/api/v1/student/sessions/{joinCode}/questions")
    @ResponseStatus(HttpStatus.CREATED)
    public StudentQuestion ask(
            @PathVariable String joinCode,
            @Valid @RequestBody StudentQuestionRequest request) {
        return studentSessions.ask(joinCode, request);
    }
}
