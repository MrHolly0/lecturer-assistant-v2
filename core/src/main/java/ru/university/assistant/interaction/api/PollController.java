package ru.university.assistant.interaction.api;

import jakarta.validation.Valid;
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
import ru.university.assistant.interaction.internal.PollService;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.org.api.CourseAccessApi;

@RestController
@RequestMapping("/api/v1/courses/{courseId}/sessions/{sessionId}")
class PollController {
    private final PollService pollService;
    private final CourseAccessApi courseAccess;
    private final LiveSessionAccessApi liveSessions;

    PollController(PollService pollService, CourseAccessApi courseAccess, LiveSessionAccessApi liveSessions) {
        this.pollService = pollService;
        this.courseAccess = courseAccess;
        this.liveSessions = liveSessions;
    }

    @PostMapping("/polls")
    @ResponseStatus(HttpStatus.CREATED)
    public PollResult startPoll(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @Valid @RequestBody StartPollRequest request) {
        courseAccess.requireManage(user, courseId);
        PollResult result = pollService.start(courseId, sessionId, user.id(), request);
        liveSessions.publishSessionUpdate(sessionId, "interaction.poll_started");
        return result;
    }

    @PostMapping("/polls/from-bank")
    @ResponseStatus(HttpStatus.CREATED)
    public PollResult startPollFromBank(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @Valid @RequestBody StartBankPollRequest request) {
        courseAccess.requireManage(user, courseId);
        PollResult result = pollService.startFromBank(courseId, sessionId, user.id(), request.questionId());
        liveSessions.publishSessionUpdate(sessionId, "interaction.poll_started");
        return result;
    }

    @GetMapping("/polls/active")
    public PollResult getActivePoll(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId) {
        courseAccess.requireManage(user, courseId);
        return pollService.getActive(courseId, sessionId);
    }

    @GetMapping("/polls")
    public ClosedPollPage listClosedPolls(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        courseAccess.requireManage(user, courseId);
        return pollService.listClosed(courseId, sessionId, limit, offset);
    }

    @GetMapping("/polls/{pollId}")
    public PollResult getPollResult(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @PathVariable UUID pollId) {
        courseAccess.requireManage(user, courseId);
        return pollService.getResult(courseId, sessionId, pollId);
    }

    @PutMapping("/polls/{pollId}/correct-option")
    public PollResult setCorrectOption(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @PathVariable UUID pollId,
            @RequestBody SetPollCorrectOptionRequest request) {
        courseAccess.requireManage(user, courseId);
        PollResult result = pollService.setCorrectOption(courseId, sessionId, pollId, request.correctOptionIdx());
        liveSessions.publishSessionUpdate(sessionId, "interaction.poll_corrected");
        return result;
    }

    @PostMapping("/polls/{pollId}/close")
    public PollResult closePoll(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @PathVariable UUID pollId,
            @RequestBody(required = false) ClosePollRequest request) {
        courseAccess.requireManage(user, courseId);
        PollResult result = pollService.close(courseId, sessionId, pollId, user.id(),
                request != null ? request : new ClosePollRequest(null));
        liveSessions.publishSessionUpdate(sessionId, "interaction.poll_closed");
        return result;
    }
}
