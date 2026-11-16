package ru.university.assistant.iam.api;

import java.time.Instant;
import java.util.UUID;
import ru.university.assistant.org.api.OrganizationModels.UnitRole;

public record InvitationResponse(
        UUID id, String code, PersonRole role, UUID courseId, UUID groupId, Instant expiresAt,
        UUID organizationUnitId, UnitRole organizationUnitRole) {
    public InvitationResponse(UUID id, String code, PersonRole role, UUID courseId, UUID groupId, Instant expiresAt,
            UUID organizationUnitId) {
        this(id, code, role, courseId, groupId, expiresAt, organizationUnitId, UnitRole.MEMBER);
    }

    public InvitationResponse(UUID id, String code, PersonRole role, UUID courseId, UUID groupId, Instant expiresAt) {
        this(id, code, role, courseId, groupId, expiresAt, null);
    }
}
