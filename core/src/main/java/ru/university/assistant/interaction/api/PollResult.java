package ru.university.assistant.interaction.api;

import java.util.List;

public record PollResult(
        QuickPoll poll,
        List<Integer> votes,   // votes[i] = count for option i
        int totalResponses) {}
