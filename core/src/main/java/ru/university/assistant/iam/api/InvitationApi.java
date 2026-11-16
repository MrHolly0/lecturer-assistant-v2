package ru.university.assistant.iam.api;

import java.util.UUID;
import java.util.Optional;
import ru.university.assistant.org.api.OrganizationModels.UnitRole;

public interface InvitationApi {
    InvitationResponse createInvitation(PersonRole role, UUID courseId, UUID groupId, UUID createdBy, Integer ttlHours);

    InvitationResponse createInvitation(
            PersonRole role, UUID courseId, UUID groupId, UUID organizationUnitId, UUID createdBy, Integer ttlHours);

    InvitationResponse createInvitation(
            PersonRole role, UUID courseId, UUID groupId, UUID organizationUnitId, UnitRole organizationUnitRole,
            UUID createdBy, Integer ttlHours);

    Optional<StaffAssignment> staffAssignment(UUID invitationId);

    record StaffAssignment(UUID unitId, UnitRole unitRole) {}
}
