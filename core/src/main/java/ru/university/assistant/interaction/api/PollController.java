package ru.university.assistant.interaction.api;

import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.interaction.internal.PollService;
import ru.university.assistant.org.api.CourseAccessApi;

@RestController
@RequestMapping("/api/v1/courses/{courseId}/sessions/{sessionId}")
class PollController {
    private final PollService pollService;
    private final CourseAccessApi courseAccess;
    private final SimpMessagingTemplate messaging;

    PollController(PollService pollService, CourseAccessApi courseAccess,
            SimpMessagingTemplate messaging) {
        this.pollService = pollService;
        this.courseAccess = courseAccess;
        this.messaging = messaging;
    }

    @PostMapping("/polls")
    @ResponseStatus(HttpStatus.CREATED)
    public PollResult startPoll(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @Valid @RequestBody StartPollRequest request) {
        courseAccess.requireManage(user, courseId);
        PollResult result = pollService.start(sessionId, user.id(), request);
        publishPollUpdate(sessionId, result);
        return result;
    }

    @GetMapping("/polls/active")
    public PollResult getActivePoll(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        courseAccess.requireManage(user, courseId);
        return pollService.getActive(sessionId);
    }

    @GetMapping("/polls/{pollId}")
    public PollResult getPollResult(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @PathVariable UUID pollId) {
        courseAccess.requireManage(user, courseId);
        return pollService.getResult(pollId);
    }

    @PostMapping("/polls/{pollId}/close")
    public PollResult closePoll(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @PathVariable UUID pollId,
            @RequestBody(required = false) ClosePollRequest request) {
        courseAccess.requireManage(user, courseId);
        PollResult result = pollService.close(pollId,
                request != null ? request : new ClosePollRequest(null));
        publishPollUpdate(sessionId, result);
        return result;
    }

    private void publishPollUpdate(UUID sessionId, PollResult result) {
        messaging.convertAndSend("/topic/session/" + sessionId,
                new PollUpdateMessage("poll.updated", result));
    }

    private record PollUpdateMessage(String type, PollResult pollResult) {}
}
