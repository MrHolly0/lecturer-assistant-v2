package ru.university.assistant.analytics.api;

import java.util.List;

public record StudentAnalyticsPage(
        List<StudentLearningAnalytics> items,
        int limit,
        int offset,
        long total) {}
