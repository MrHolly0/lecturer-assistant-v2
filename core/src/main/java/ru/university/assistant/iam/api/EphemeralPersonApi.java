package ru.university.assistant.iam.api;

import java.util.UUID;

public interface EphemeralPersonApi {
    UserProfile createEphemeralStudent(String displayName);

    void updateStudentDisplayName(UUID personId, String displayName);
}
