package ru.university.assistant.interaction.api;

import java.util.List;

public record ClosedPollPage(
        List<PollResult> items,
        int limit,
        int offset,
        long total) {}
