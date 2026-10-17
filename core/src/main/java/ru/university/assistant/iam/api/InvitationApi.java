package ru.university.assistant.iam.api;

import java.util.UUID;
import java.util.Optional;

public interface InvitationApi {
    InvitationResponse createInvitation(PersonRole role, UUID courseId, UUID groupId, UUID createdBy, Integer ttlHours);

    InvitationResponse createInvitation(
            PersonRole role, UUID courseId, UUID groupId, UUID organizationUnitId, UUID createdBy, Integer ttlHours);

    Optional<UUID> organizationUnit(UUID invitationId);
}
