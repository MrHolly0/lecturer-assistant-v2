package ru.university.assistant.live.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ActiveSessionSummary(
        UUID sessionId,
        UUID courseId,
        String joinCode,
        String lectureTitle,
        List<SessionGroup> groups,
        int currentSlideIdx,
        SessionStatus status,
        Instant startedAt) {
    public static ActiveSessionSummary of(LiveSession session) {
        return new ActiveSessionSummary(
                session.id(), session.courseId(), session.joinCode(), session.lectureTitle(),
                session.groups(), session.currentSlideIdx(), session.status(), session.startedAt());
    }
}
