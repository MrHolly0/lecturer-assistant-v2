package ru.university.assistant.org.api;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.InvitationResponse;
import ru.university.assistant.org.internal.CourseService;

@RestController
@RequestMapping("/api/v1/courses")
public class CourseController {
    private final CourseService courseService;

    CourseController(CourseService courseService) {
        this.courseService = courseService;
    }

    @GetMapping
    public List<Course> list(@AuthenticationPrincipal AuthenticatedUser user) {
        return courseService.listCourses(user);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Course create(@AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody CreateCourseRequest request) {
        return courseService.createCourse(user, request);
    }

    @GetMapping("/{courseId}")
    public CourseDetails get(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId) {
        return courseService.getCourse(user, courseId);
    }

    @DeleteMapping("/{courseId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archive(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId) {
        courseService.archiveCourse(user, courseId);
    }

    @PostMapping("/{courseId}/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    public InvitationResponse invite(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @Valid @RequestBody CreateCourseInvitationRequest request) {
        return courseService.createInvitation(user, courseId, request);
    }

    @GetMapping("/{courseId}/members")
    public List<CourseMember> members(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId) {
        return courseService.listMembers(user, courseId);
    }

    @GetMapping("/{courseId}/groups")
    public List<StudyGroup> groups(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId) {
        return courseService.listGroups(user, courseId);
    }

    @PostMapping("/{courseId}/groups")
    @ResponseStatus(HttpStatus.CREATED)
    public StudyGroup createGroup(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @Valid @RequestBody CreateStudyGroupRequest request) {
        return courseService.createGroup(user, courseId, request);
    }

    @DeleteMapping("/{courseId}/groups/{groupId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteGroup(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @PathVariable UUID groupId) {
        courseService.deleteGroup(user, courseId, groupId);
    }

    @GetMapping("/{courseId}/bans")
    public List<CourseBan> bans(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId) {
        return courseService.listBans(user, courseId);
    }

    @PostMapping("/{courseId}/bans")
    @ResponseStatus(HttpStatus.CREATED)
    public CourseBan ban(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId,
            @Valid @RequestBody BanCourseMemberRequest request) {
        return courseService.ban(user, courseId, request);
    }
}
