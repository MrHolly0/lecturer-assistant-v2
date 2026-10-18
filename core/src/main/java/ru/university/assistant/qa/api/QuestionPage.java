package ru.university.assistant.qa.api;

import java.util.List;

public record QuestionPage(
        List<StudentQuestion> items, long total, int limit, int offset, QuestionCounts counts) {}
