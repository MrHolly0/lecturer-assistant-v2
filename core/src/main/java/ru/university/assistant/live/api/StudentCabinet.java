package ru.university.assistant.live.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record StudentCabinet(List<Entry> ongoing, boolean moreOngoing, List<Entry> history,
        long historyTotal, int historyLimit, int historyOffset) {
    public record Entry(UUID sessionId, String title, String courseTitle, String groups,
            String joinCode, String status, boolean joined, Instant startedAt, Instant endedAt,
            Instant joinedAt, Instant leftAt) {}
}
