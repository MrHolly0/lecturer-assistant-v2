package ru.university.assistant.org.api;

import java.util.UUID;

/** Public IAM-to-organization boundary for staff invitation assignment and role changes. */
public interface StaffMembershipApi {
    void validateInvitationTarget(UUID unitId);

    void addInvitedStaff(UUID personId, UUID invitationId);

    void removeStaffMembershipIfStudent(UUID personId);
}
