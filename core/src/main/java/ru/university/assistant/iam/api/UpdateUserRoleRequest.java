package ru.university.assistant.iam.api;

import jakarta.validation.constraints.NotNull;

public record UpdateUserRoleRequest(@NotNull PersonRole role) {}
