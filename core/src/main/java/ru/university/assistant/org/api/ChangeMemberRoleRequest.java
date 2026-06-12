package ru.university.assistant.org.api;

import jakarta.validation.constraints.NotNull;

public record ChangeMemberRoleRequest(@NotNull CourseRole role) {}
