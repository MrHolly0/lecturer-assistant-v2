package ru.university.assistant.analytics.api;

import java.util.List;
import java.util.UUID;

public record StudentLearningAnalytics(
        UUID personId,
        String displayName,
        List<AnalyticsGroupRef> groups,
        LearningMetrics metrics) {}
