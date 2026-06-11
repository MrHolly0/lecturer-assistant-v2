package ru.university.assistant.iam.api;

import java.time.Instant;
import java.util.UUID;

public record InvitationResponse(
        UUID id, String code, PersonRole role, UUID courseId, UUID groupId, Instant expiresAt) {}
