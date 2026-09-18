package ru.university.assistant.org.api;

import java.util.UUID;

public interface CourseMembershipApi {
    /** Добавляет студента в курс один раз; уже существующую роль (например, преподавателя) не меняет. */
    void ensureStudentMember(UUID courseId, UUID personId);

    void addMemberFromInvitation(UUID courseId, UUID groupId, UUID personId, CourseRole role);
}
