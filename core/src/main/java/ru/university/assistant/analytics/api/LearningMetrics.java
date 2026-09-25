package ru.university.assistant.analytics.api;

public record LearningMetrics(
        int memberCount,
        int participantCount,
        long sessionAttendances,
        long greenSignals,
        long yellowSignals,
        long redSignals,
        long signalCount,
        Double greenShare,
        Double yellowShare,
        Double redShare,
        long checkAnswers,
        long gradedAnswers,
        long correctAnswers,
        Double correctRate,
        long questionsAsked,
        long questionsAnswered) {}
