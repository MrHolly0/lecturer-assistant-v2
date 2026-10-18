package ru.university.assistant.live.internal;

import java.time.Instant;
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
    public SessionHistoryPage list(
            AuthenticatedUser user,
            UUID courseId,
            int limit,
            int offset,
            String query,
            UUID groupId,
            Instant endedFrom,
            Instant endedBefore) {
        courseAccess.requireManage(user, courseId);
        if (limit < 1 || limit > MAX_LIMIT || offset < 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "limit must be between 1 and 100 and offset must be non-negative");
        }
        if (query != null && query.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "query must be at most 200 characters");
        }
        if (endedFrom != null && endedBefore != null && !endedFrom.isBefore(endedBefore)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "endedFrom must be before endedBefore");
        }
        return new SessionHistoryPage(
                history.list(courseId, query, groupId, endedFrom, endedBefore, limit, offset),
                history.availableGroups(courseId),
                limit,
                offset,
                history.count(courseId, query, groupId, endedFrom, endedBefore));
    }
}
