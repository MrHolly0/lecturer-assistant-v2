package ru.university.assistant.org.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record AddCourseMemberRequest(@NotNull UUID personId, @NotNull CourseRole role, UUID groupId) {}
