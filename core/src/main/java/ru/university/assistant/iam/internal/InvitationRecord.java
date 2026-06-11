package ru.university.assistant.iam.internal;

import java.time.Instant;
import java.util.UUID;
import ru.university.assistant.iam.api.InvitationResponse;
import ru.university.assistant.iam.api.PersonRole;

record InvitationRecord(UUID id, String code, PersonRole role, UUID courseId, UUID groupId, Instant expiresAt) {
    InvitationResponse toResponse() {
        return new InvitationResponse(id, code, role, courseId, groupId, expiresAt);
    }
}
