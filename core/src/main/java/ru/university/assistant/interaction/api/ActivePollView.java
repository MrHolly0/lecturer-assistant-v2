package ru.university.assistant.interaction.api;

import java.util.List;
import java.util.UUID;

/** Что студент видит в SSE-снапшоте: нет правильного ответа до закрытия опроса. */
public record ActivePollView(
        UUID pollId,
        String questionText,
        List<String> options,
        PollStatus status,
        Integer correctOptionIdx,  // null пока OPEN
        List<Integer> votes) {}
