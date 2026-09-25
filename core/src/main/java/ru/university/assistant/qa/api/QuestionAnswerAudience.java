package ru.university.assistant.qa.api;

import java.util.UUID;

/** Внутренний контракт доставки; authorPersonId не входит в student HTTP DTO. */
public record QuestionAnswerAudience(UUID authorPersonId, StudentQuestionAnswer answer) {}
