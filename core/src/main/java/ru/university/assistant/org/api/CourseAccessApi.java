package ru.university.assistant.org.api;

import java.util.UUID;
import ru.university.assistant.iam.api.AuthenticatedUser;

public interface CourseAccessApi {
    void requireVisible(AuthenticatedUser user, UUID courseId);

    void requireManage(AuthenticatedUser user, UUID courseId);
}
