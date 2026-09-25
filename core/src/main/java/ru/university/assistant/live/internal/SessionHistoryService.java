package ru.university.assistant.live.internal;

import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.SessionHistoryPage;
import ru.university.assistant.org.api.CourseAccessApi;

@Service
public class SessionHistoryService {
    private static final int MAX_LIMIT = 100;

    private final CourseAccessApi courseAccess;
    private final SessionHistoryRepository history;

    SessionHistoryService(CourseAccessApi courseAccess, SessionHistoryRepository history) {
        this.courseAccess = courseAccess;
        this.history = history;
    }

    @Transactional(readOnly = true)
    public SessionHistoryPage list(AuthenticatedUser user, UUID courseId, int limit, int offset) {
        courseAccess.requireManage(user, courseId);
        if (limit < 1 || limit > MAX_LIMIT || offset < 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "limit must be between 1 and 100 and offset must be non-negative");
        }
        return new SessionHistoryPage(history.list(courseId, limit, offset), limit, offset, history.count(courseId));
    }
}
