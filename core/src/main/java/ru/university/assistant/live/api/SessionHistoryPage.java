package ru.university.assistant.live.api;

import java.util.List;

public record SessionHistoryPage(
        List<SessionHistoryItem> items,
        List<SessionGroup> availableGroups,
        int limit,
        int offset,
        long total) {}
