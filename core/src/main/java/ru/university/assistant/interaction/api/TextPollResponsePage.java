package ru.university.assistant.interaction.api;

import java.util.List;

public record TextPollResponsePage(List<TextPollResponse> items, long total, int limit, int offset) {}
