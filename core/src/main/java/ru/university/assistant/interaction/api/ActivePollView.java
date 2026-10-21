package ru.university.assistant.interaction.api;

import java.util.List;
import java.util.UUID;

/**
 * Что студент видит в снапшоте. До закрытия опроса нет ни правильного ответа, ни распределения
 * (correctOptionIdx и votes равны null), после закрытия опрос остаётся в снапшоте.
 * У SHORT_ANSWER нет вариантов и оценки.
 */
public record ActivePollView(
        UUID pollId,
        String questionText,
        List<String> options,
        PollStatus status,
        Integer correctOptionIdx,  // null пока OPEN
        List<Integer> votes,
        QuestionType questionType) {
    public ActivePollView(
            UUID pollId,
            String questionText,
            List<String> options,
            PollStatus status,
            Integer correctOptionIdx,  // null пока OPEN
            List<Integer> votes) {
        this(pollId, questionText, options, status, correctOptionIdx, votes, QuestionType.CHOICE);
    }
}
