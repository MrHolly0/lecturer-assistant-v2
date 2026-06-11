package ru.university.assistant.org.api;

import java.util.List;
import java.util.UUID;

public record CourseDetails(
        UUID id,
        String title,
        UUID ownerPersonId,
        boolean archived,
        CourseRole myRole,
        boolean canManage,
        List<CourseMember> members,
        List<StudyGroup> groups) {}
