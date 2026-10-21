package ru.university.assistant.interaction.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

public record CreateQuestionRequest(
        @NotBlank String text,
        @NotNull QuestionType questionType,
        @NotNull @Valid List<QuestionOption> options,
        List<String> tags,
        @Size(max = 200) List<@NotNull UUID> lectureIds) {}
