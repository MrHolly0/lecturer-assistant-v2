package ru.university.assistant.org.api;

import java.util.UUID;

public record CourseMember(UUID courseId, UUID personId, String displayName, CourseRole role) {}
