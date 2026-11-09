package ru.university.assistant.qa.api;

/** Author identifiers are deliberately absent, including for anonymous questions. */
public record QuestionAuthorModeration(boolean muted, int hiddenQuestions) {}
