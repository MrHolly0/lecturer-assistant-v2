package ru.university.assistant.qa.api;

import java.util.List;

public record StudentQuestionHistory(
        List<StudentQuestion> myQuestions,
        List<StudentQuestionAnswer> questionAnswers,
        boolean hasMore) {}
