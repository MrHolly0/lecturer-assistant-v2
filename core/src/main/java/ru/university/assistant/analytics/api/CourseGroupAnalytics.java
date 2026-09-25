package ru.university.assistant.analytics.api;

import java.util.List;
import java.util.UUID;

public record CourseGroupAnalytics(
        UUID courseId,
        LearningMetrics overall,
        List<GroupLearningAnalytics> groups,
        LearningMetrics ungrouped,
        LearningMetrics unidentified) {}
