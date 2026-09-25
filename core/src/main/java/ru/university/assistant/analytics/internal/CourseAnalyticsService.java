package ru.university.assistant.analytics.internal;

import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.analytics.api.AnalyticsGroupRef;
import ru.university.assistant.analytics.api.CourseGroupAnalytics;
import ru.university.assistant.analytics.api.GroupLearningAnalytics;
import ru.university.assistant.analytics.api.StudentAnalyticsPage;
import ru.university.assistant.analytics.api.StudentLearningAnalytics;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.org.api.CourseAccessApi;

@Service
public class CourseAnalyticsService {
    private static final int MAX_PAGE_SIZE = 100;

    private final CourseAccessApi courseAccess;
    private final CourseAnalyticsRepository analytics;

    CourseAnalyticsService(CourseAccessApi courseAccess, CourseAnalyticsRepository analytics) {
        this.courseAccess = courseAccess;
        this.analytics = analytics;
    }

    @Transactional(readOnly = true)
    public CourseGroupAnalytics groups(AuthenticatedUser user, UUID courseId) {
        courseAccess.requireManage(user, courseId);
        List<UUID> overallIds = analytics.stableStudentIds(courseId, null, false);
        List<AnalyticsGroupRef> groups = analytics.groups(courseId);
        List<GroupLearningAnalytics> groupMetrics = groups.stream()
                .map(group -> new GroupLearningAnalytics(
                        group.id(),
                        group.name(),
                        analytics.historicalGroupMetrics(courseId, group.id())))
                .toList();
        List<UUID> ungroupedIds = analytics.stableStudentIds(courseId, null, true);
        return new CourseGroupAnalytics(
                courseId,
                analytics.metrics(courseId, overallIds),
                groupMetrics,
                analytics.metrics(courseId, ungroupedIds),
                analytics.unidentifiedMetrics(courseId));
    }

    @Transactional(readOnly = true)
    public StudentAnalyticsPage students(
            AuthenticatedUser user, UUID courseId, UUID groupId, int limit, int offset) {
        courseAccess.requireManage(user, courseId);
        validatePage(limit, offset);
        if (groupId != null && !analytics.groupExists(courseId, groupId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Group not found");
        }
        List<StudentLearningAnalytics> items = analytics.students(courseId, groupId, limit, offset).stream()
                .map(student -> studentAnalytics(courseId, student))
                .toList();
        return new StudentAnalyticsPage(
                items, limit, offset, analytics.studentCount(courseId, groupId));
    }

    @Transactional(readOnly = true)
    public StudentLearningAnalytics student(AuthenticatedUser user, UUID courseId, UUID personId) {
        courseAccess.requireManage(user, courseId);
        AnalyticsStudent student = analytics.student(courseId, personId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Student not found"));
        return studentAnalytics(courseId, student);
    }

    private StudentLearningAnalytics studentAnalytics(UUID courseId, AnalyticsStudent student) {
        return new StudentLearningAnalytics(
                student.personId(),
                student.displayName(),
                analytics.groupsForStudent(courseId, student.personId()),
                analytics.metrics(courseId, List.of(student.personId())));
    }

    private void validatePage(int limit, int offset) {
        if (limit < 1 || limit > MAX_PAGE_SIZE || offset < 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "limit must be between 1 and 100 and offset must be non-negative");
        }
    }
}
