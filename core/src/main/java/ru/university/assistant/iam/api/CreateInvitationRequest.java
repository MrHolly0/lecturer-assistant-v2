package ru.university.assistant.iam.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;
import ru.university.assistant.org.api.OrganizationModels.UnitRole;

public record CreateInvitationRequest(
        @NotNull PersonRole role, @Min(1) Integer ttlHours, UUID organizationUnitId, UnitRole organizationUnitRole) {
    public CreateInvitationRequest {
        organizationUnitRole = organizationUnitRole == null ? UnitRole.MEMBER : organizationUnitRole;
    }

    public CreateInvitationRequest(PersonRole role, Integer ttlHours, UUID organizationUnitId) {
        this(role, ttlHours, organizationUnitId, UnitRole.MEMBER);
    }

    public CreateInvitationRequest(PersonRole role, Integer ttlHours) {
        this(role, ttlHours, null);
    }
}
