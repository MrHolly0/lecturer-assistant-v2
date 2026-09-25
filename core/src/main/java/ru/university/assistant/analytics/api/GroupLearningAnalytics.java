package ru.university.assistant.analytics.api;

import java.util.UUID;

public record GroupLearningAnalytics(UUID groupId, String groupName, LearningMetrics metrics) {}
