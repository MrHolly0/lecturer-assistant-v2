package ru.university.assistant.live.api;

import java.util.Map;
import java.util.UUID;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.interaction.api.ActivePollView;

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
        SignalAggregate signalAggregate,
        ActivePollView activePoll,
        /** Выбор текущего студента в опросе; заполняется только в GET-снапшоте с идентификацией, в SSE — null. */
        Integer myVote) {}
