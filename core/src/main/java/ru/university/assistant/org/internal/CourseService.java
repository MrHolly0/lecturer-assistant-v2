package ru.university.assistant.org.internal;

import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.InvitationApi;
import ru.university.assistant.iam.api.InvitationResponse;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.org.api.BanCourseMemberRequest;
import ru.university.assistant.org.api.Course;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.org.api.CourseBan;
import ru.university.assistant.org.api.CourseDetails;
import ru.university.assistant.org.api.CourseMembershipApi;
import ru.university.assistant.org.api.CourseMember;
import ru.university.assistant.org.api.CourseRole;
import ru.university.assistant.org.api.CreateCourseInvitationRequest;
import ru.university.assistant.org.api.CreateCourseRequest;
import ru.university.assistant.org.api.CreateStudyGroupRequest;
import ru.university.assistant.org.api.StudyGroup;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class CourseService implements CourseMembershipApi, CourseAccessApi {
    private final CourseRepository courses;
    private final InvitationApi invitations;

    CourseService(CourseRepository courses, InvitationApi invitations) {
        this.courses = courses;
        this.invitations = invitations;
    }

    @Transactional
    public Course createCourse(AuthenticatedUser user, CreateCourseRequest request) {
        if (user.role() != PersonRole.ADMIN && user.role() != PersonRole.LECTURER) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only admins and lecturers can create courses");
        }
        Course course = courses.create(UuidV7.generate(), user.id(), request.title().trim());
        courses.addMember(course.id(), user.id(), CourseRole.LECTURER);
        return course;
    }

    public List<Course> listCourses(AuthenticatedUser user) {
        return courses.listForPerson(user.id(), user.role() == PersonRole.ADMIN);
    }

    public CourseDetails getCourse(AuthenticatedUser user, UUID courseId) {
        Course course = visibleCourse(user, courseId);
        CourseRole myRole = courses.findMemberRole(courseId, user.id()).orElse(null);
        return new CourseDetails(
                course.id(),
                course.title(),
                course.ownerPersonId(),
                course.archived(),
                myRole,
                canManage(user, myRole),
                courses.listMembers(course.id()),
                courses.listGroups(course.id()));
    }

    @Transactional
    public void archiveCourse(AuthenticatedUser user, UUID courseId) {
        requireManage(user, courseId);
        courses.archive(courseId);
    }

    @Transactional
    public void restoreCourse(AuthenticatedUser user, UUID courseId) {
        requireManage(user, courseId);
        courses.restore(courseId);
    }

    @Transactional
    public void hardDeleteCourse(AuthenticatedUser user, UUID courseId) {
        requireManage(user, courseId);
        Course course = courses.findById(courseId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Course not found"));
        if (!course.archived()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Archive course before permanent deletion");
        }
        courses.delete(courseId);
    }

    public List<CourseMember> listMembers(AuthenticatedUser user, UUID courseId) {
        requireVisible(user, courseId);
        return courses.listMembers(courseId);
    }

    public List<StudyGroup> listGroups(AuthenticatedUser user, UUID courseId) {
        requireVisible(user, courseId);
        return courses.listGroups(courseId);
    }

    @Transactional
    public StudyGroup createGroup(AuthenticatedUser user, UUID courseId, CreateStudyGroupRequest request) {
        requireManage(user, courseId);
        return courses.createGroup(UuidV7.generate(), courseId, request.name().trim());
    }

    @Transactional
    public void deleteGroup(AuthenticatedUser user, UUID courseId, UUID groupId) {
        requireManage(user, courseId);
        if (!courses.groupBelongsToCourse(groupId, courseId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Group not found");
        }
        courses.deleteGroup(groupId);
    }

    @Transactional
    public InvitationResponse createInvitation(
            AuthenticatedUser user, UUID courseId, CreateCourseInvitationRequest request) {
        requireManage(user, courseId);
        if (request.groupId() != null && !courses.groupBelongsToCourse(request.groupId(), courseId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Group does not belong to course");
        }
        return invitations.createInvitation(
                toPersonRole(request.role()), courseId, request.groupId(), user.id(), request.ttlHours());
    }

    @Transactional
    public CourseBan ban(AuthenticatedUser user, UUID courseId, BanCourseMemberRequest request) {
        requireManage(user, courseId);
        return courses.ban(courseId, request.personId(), request.reason(), user.id());
    }

    public List<CourseBan> listBans(AuthenticatedUser user, UUID courseId) {
        requireManage(user, courseId);
        return courses.listBans(courseId);
    }

    @Override
    @Transactional
    public void addMemberFromInvitation(UUID courseId, UUID groupId, UUID personId, CourseRole role) {
        courses.addMember(courseId, personId, role);
        if (groupId != null) {
            courses.addGroupMember(groupId, personId);
        }
    }

    @Override
    public void requireVisible(AuthenticatedUser user, UUID courseId) {
        visibleCourse(user, courseId);
    }

    @Override
    public void requireManage(AuthenticatedUser user, UUID courseId) {
        ensureManage(user, courseId);
    }

    private Course visibleCourse(AuthenticatedUser user, UUID courseId) {
        Course course = courses.findById(courseId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Course not found"));
        if (user.role() == PersonRole.ADMIN || courses.findMemberRole(courseId, user.id()).isPresent()) {
            return course;
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Course is not visible");
    }

    private void ensureManage(AuthenticatedUser user, UUID courseId) {
        if (user.role() == PersonRole.ADMIN) {
            return;
        }
        CourseRole role = courses.findMemberRole(courseId, user.id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN, "Course is not visible"));
        if (!canManage(user, role)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Course management is not allowed");
        }
    }

    private boolean canManage(AuthenticatedUser user, CourseRole role) {
        return user.role() == PersonRole.ADMIN || role == CourseRole.LECTURER || role == CourseRole.ASSISTANT;
    }

    private PersonRole toPersonRole(CourseRole role) {
        return switch (role) {
            case LECTURER -> PersonRole.LECTURER;
            case ASSISTANT -> PersonRole.ASSISTANT;
            case STUDENT -> PersonRole.STUDENT;
        };
    }
}
