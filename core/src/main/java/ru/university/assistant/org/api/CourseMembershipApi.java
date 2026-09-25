package ru.university.assistant.org.api;

import java.util.List;
import java.util.UUID;

public interface CourseMembershipApi {
    /** Добавляет студента в курс один раз; уже существующую роль (например, преподавателя) не меняет. */
    void ensureStudentMember(UUID courseId, UUID personId);

    /** Resolves an existing group or atomically creates one for a session start. */
    StudyGroup resolveSessionGroup(UUID courseId, UUID groupId, String groupName);

    /** Adds a student to the course and selects one allowed session group without silently moving them. */
    StudyGroup ensureStudentMemberInSessionGroups(
            UUID courseId, UUID personId, List<StudyGroup> allowedGroups, UUID requestedGroupId);

    void addMemberFromInvitation(UUID courseId, UUID groupId, UUID personId, CourseRole role);
}
