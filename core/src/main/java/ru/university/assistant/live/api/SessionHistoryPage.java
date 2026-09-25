package ru.university.assistant.live.api;

import java.util.List;

public record SessionHistoryPage(
        List<SessionHistoryItem> items,
        int limit,
        int offset,
        long total) {}
