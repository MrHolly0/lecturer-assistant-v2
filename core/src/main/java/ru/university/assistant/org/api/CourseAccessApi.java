package ru.university.assistant.org.api;

import java.util.UUID;
import java.util.Set;
import ru.university.assistant.iam.api.AuthenticatedUser;

public interface CourseAccessApi {
    void requireVisible(AuthenticatedUser user, UUID courseId);

    void requireManage(AuthenticatedUser user, UUID courseId);

    void requireParticipation(UUID courseId, UUID personId);

    Set<UUID> allowedParticipants(UUID courseId, Set<UUID> personIds);
}
