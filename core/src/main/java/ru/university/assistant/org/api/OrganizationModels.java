package ru.university.assistant.org.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;

public final class OrganizationModels {
    private OrganizationModels() {}

    public enum UnitKind { UNIT, FACULTY, DEPARTMENT }

    public enum UnitRole { MEMBER, MANAGER }

    public record OrganizationUnit(
            UUID id, UUID parentId, String name, UnitKind kind,
            int directMembersCount, int totalMembersCount, boolean canManage, boolean canViewMembers) {}

    public record OrganizationView(List<OrganizationUnit> units, boolean administrator) {}

    public record OrganizationMember(
            UUID id, String displayName, String email, PersonRole role, PersonStatus status,
            UUID unitId, String unitName, UnitRole unitRole) {}

    public record SaveUnitRequest(
            @NotBlank @Size(max = 120) String name, @NotNull UnitKind kind, UUID parentId) {}

    public record AssignStaffRequest(UUID unitId, @NotNull UnitRole unitRole) {}
}
