package ru.university.assistant.live.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import ru.university.assistant.interaction.api.PollStatus;
import ru.university.assistant.interaction.api.QuestionType;

public record SummaryPollResult(
        UUID pollId,
        UUID sourceQuestionId,
        String questionText,
        List<String> options,
        PollStatus status,
        List<Integer> votes,
        int totalResponses,
        Integer correctOptionIdx,
        Instant startedAt,
        Instant closedAt,
        QuestionType questionType) {
    public SummaryPollResult(
            UUID pollId,
            UUID sourceQuestionId,
            String questionText,
            List<String> options,
            PollStatus status,
            List<Integer> votes,
            int totalResponses,
            Integer correctOptionIdx,
            Instant startedAt,
            Instant closedAt) {
        this(pollId,
                sourceQuestionId, questionText, options, status, votes, totalResponses, correctOptionIdx,
                startedAt, closedAt, QuestionType.CHOICE);
    }
}
