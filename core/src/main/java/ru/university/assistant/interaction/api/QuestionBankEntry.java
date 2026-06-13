package ru.university.assistant.interaction.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record QuestionBankEntry(
        UUID id,
        UUID courseId,
        String text,
        QuestionType questionType,
        List<QuestionOption> options,
        List<String> tags,
        boolean archived,
        Instant createdAt) {}
