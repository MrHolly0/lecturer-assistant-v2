package ru.university.assistant.live.api;

import java.util.Map;
import java.util.UUID;
import ru.university.assistant.feedback.api.SignalAggregate;

public record StudentSessionSnapshot(
        UUID sessionId,
        UUID courseId,
        String lectureTitle,
        SessionStatus status,
        String joinCode,
        int currentSlideIdx,
        int slideCount,
        StudentSlide currentSlide,
        Map<String, Object> annotations,
        SignalAggregate signalAggregate) {}
