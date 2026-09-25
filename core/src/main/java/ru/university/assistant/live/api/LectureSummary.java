package ru.university.assistant.live.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.qa.api.StudentQuestion;

public record LectureSummary(
        UUID sessionId,
        UUID lectureId,
        String lectureTitle,
        SessionStatus status,
        Instant startedAt,
        Instant endedAt,
        long durationSeconds,
        int participantCount,
        List<SessionParticipant> participants,
        SignalAggregate signalTotals,
        List<SummaryProblemSlide> problemSlides,
        List<SummaryPollResult> pollResults,
        int questionsCount,
        int unansweredQuestionCount,
        List<StudentQuestion> unansweredQuestions) {}
