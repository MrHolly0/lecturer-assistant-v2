package ru.university.assistant.live.api;

import java.util.List;
import ru.university.assistant.feedback.api.SignalAggregate;

public record LectureGroupSummary(
        SessionGroup group,
        int participantCount,
        SignalAggregate signalTotals,
        List<SummaryProblemSlide> problemSlides,
        List<SummaryPollResult> pollResults,
        int questionsCount,
        int unansweredQuestionCount) {}
