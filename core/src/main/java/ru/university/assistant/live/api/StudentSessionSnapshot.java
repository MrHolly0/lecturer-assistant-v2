package ru.university.assistant.live.api;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.interaction.api.ActivePollView;
import ru.university.assistant.qa.api.StudentQuestionAnswer;

public record StudentSessionSnapshot(
        UUID sessionId,
        UUID courseId,
        String courseTitle,
        String lectureTitle,
        List<SessionGroup> groups,
        SessionStatus status,
        String joinCode,
        int currentSlideIdx,
        int slideCount,
        StudentSlide currentSlide,
        Map<String, Object> annotations,
        SignalAggregate signalAggregate,
        ActivePollView activePoll,
        /** Выбор текущего студента в опросе; заполняется только в GET-снапшоте с идентификацией, в SSE — null. */
        Integer myVote,
        List<StudentQuestionAnswer> questionAnswers,
        boolean kicked,
        boolean nameRequested) {}
