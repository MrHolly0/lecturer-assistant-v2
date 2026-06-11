package ru.university.assistant.iam.internal;

import java.util.UUID;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.iam.api.UserProfile;

record PersonRecord(
        UUID id, String displayName, String email, String passwordHash, PersonRole role, PersonStatus status) {
    UserProfile toProfile() {
        return new UserProfile(id, displayName, email, role, status);
    }
}
