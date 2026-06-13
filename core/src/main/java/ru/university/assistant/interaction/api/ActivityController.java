package ru.university.assistant.interaction.api;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.interaction.internal.ActivityService;
import ru.university.assistant.org.api.CourseAccessApi;

@RestController
@RequestMapping("/api/v1/courses/{courseId}")
class ActivityController {
    private final ActivityService service;
    private final CourseAccessApi courseAccess;

    ActivityController(ActivityService service, CourseAccessApi courseAccess) {
        this.service = service;
        this.courseAccess = courseAccess;
    }

    @PostMapping("/activities")
    @ResponseStatus(HttpStatus.CREATED)
    public ActivityDefinition createDefinition(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @Valid @RequestBody CreateActivityRequest request) {
        courseAccess.requireManage(user, courseId);
        return service.createDefinition(courseId, user.id(), request);
    }

    @GetMapping("/activities")
    public List<ActivityDefinition> listDefinitions(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId) {
        courseAccess.requireManage(user, courseId);
        return service.listDefinitions(courseId);
    }

    @GetMapping("/activities/{definitionId}")
    public ActivityDefinition getDefinition(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID definitionId) {
        courseAccess.requireManage(user, courseId);
        return service.getDefinition(definitionId);
    }

    @PostMapping("/sessions/{sessionId}/activities/{definitionId}/runs")
    @ResponseStatus(HttpStatus.CREATED)
    public ActivityRun startRun(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @PathVariable UUID definitionId) {
        courseAccess.requireManage(user, courseId);
        return service.startRun(definitionId, sessionId);
    }

    @PostMapping("/sessions/{sessionId}/activity-runs/{runId}/close")
    public ActivityRun closeRun(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @PathVariable UUID runId) {
        courseAccess.requireManage(user, courseId);
        return service.closeRun(runId);
    }

    @GetMapping("/sessions/{sessionId}/activity-runs/{runId}/responses")
    public List<ActivityResponse> getResponses(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID sessionId,
            @PathVariable UUID runId) {
        courseAccess.requireManage(user, courseId);
        return service.getResponses(runId);
    }
}
