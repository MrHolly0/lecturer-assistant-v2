package ru.university.assistant.iam.api;

import java.util.UUID;

public interface InvitationApi {
    InvitationResponse createInvitation(PersonRole role, UUID courseId, UUID groupId, UUID createdBy, Integer ttlHours);
}
