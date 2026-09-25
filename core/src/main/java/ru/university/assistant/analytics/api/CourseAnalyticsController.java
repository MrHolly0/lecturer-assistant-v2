package ru.university.assistant.analytics.api;

import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.analytics.internal.CourseAnalyticsService;
import ru.university.assistant.iam.api.AuthenticatedUser;

@RestController
@RequestMapping("/api/v1/courses/{courseId}/analytics")
public class CourseAnalyticsController {
    private final CourseAnalyticsService analytics;

    CourseAnalyticsController(CourseAnalyticsService analytics) {
        this.analytics = analytics;
    }

    @GetMapping("/groups")
    public CourseGroupAnalytics groups(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId) {
        return analytics.groups(user, courseId);
    }

    @GetMapping("/students")
    public StudentAnalyticsPage students(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @RequestParam(required = false) UUID groupId,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        return analytics.students(user, courseId, groupId, limit, offset);
    }

    @GetMapping("/students/{personId}")
    public StudentLearningAnalytics student(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID personId) {
        return analytics.student(user, courseId, personId);
    }
}
