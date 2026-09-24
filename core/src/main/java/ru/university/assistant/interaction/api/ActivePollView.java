package ru.university.assistant.interaction.api;

import java.util.List;
import java.util.UUID;

/**
 * Что студент видит в снапшоте. До закрытия опроса нет ни правильного ответа, ни распределения
 * (correctOptionIdx и votes равны null), после закрытия опрос остаётся в снапшоте с обоими.
 */
public record ActivePollView(
        UUID pollId,
        String questionText,
        List<String> options,
        PollStatus status,
        Integer correctOptionIdx,  // null пока OPEN
        List<Integer> votes) {}  // null пока OPEN
