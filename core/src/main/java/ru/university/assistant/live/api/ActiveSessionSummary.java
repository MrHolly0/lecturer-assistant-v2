package ru.university.assistant.live.api;

import java.util.UUID;

public record ActiveSessionSummary(
        UUID sessionId, UUID courseId, String joinCode, String lectureTitle, int currentSlideIdx) {
    public static ActiveSessionSummary of(LiveSession session) {
        return new ActiveSessionSummary(
                session.id(), session.courseId(), session.joinCode(), session.lectureTitle(),
                session.currentSlideIdx());
    }
}
