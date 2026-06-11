package ru.university.assistant.org.api;

import java.util.UUID;

public interface CourseMembershipApi {
    void addMemberFromInvitation(UUID courseId, UUID groupId, UUID personId, CourseRole role);
}
