package ru.university.assistant.org.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record CreateCourseInvitationRequest(@NotNull CourseRole role, UUID groupId, @Min(1) Integer ttlHours) {}
