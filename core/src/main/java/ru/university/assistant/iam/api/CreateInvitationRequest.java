package ru.university.assistant.iam.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record CreateInvitationRequest(@NotNull PersonRole role, @Min(1) Integer ttlHours) {}
