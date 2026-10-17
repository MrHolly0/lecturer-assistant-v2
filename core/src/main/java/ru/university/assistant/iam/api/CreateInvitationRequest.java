package ru.university.assistant.iam.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record CreateInvitationRequest(@NotNull PersonRole role, @Min(1) Integer ttlHours, UUID organizationUnitId) {
    public CreateInvitationRequest(PersonRole role, Integer ttlHours) {
        this(role, ttlHours, null);
    }
}
