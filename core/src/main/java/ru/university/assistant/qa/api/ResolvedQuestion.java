package ru.university.assistant.qa.api;

import java.util.UUID;

public record ResolvedQuestion(
        StudentQuestion question,
        UUID authorPersonId,
        StudentQuestionAnswer studentAnswer,
        boolean changed) {}
