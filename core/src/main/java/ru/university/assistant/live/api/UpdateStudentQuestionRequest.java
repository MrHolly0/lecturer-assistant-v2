package ru.university.assistant.live.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import ru.university.assistant.qa.api.QuestionStatus;

public record UpdateStudentQuestionRequest(
        @NotNull QuestionStatus status,
        @Size(max = 4000) String answerText) {}
