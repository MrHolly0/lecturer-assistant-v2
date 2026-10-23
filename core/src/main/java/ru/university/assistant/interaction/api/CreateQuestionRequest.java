package ru.university.assistant.interaction.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

public record CreateQuestionRequest(
        @NotBlank @Size(max = 10000) String text,
        @NotNull QuestionType questionType,
        @NotNull @Size(max = 100) @Valid List<QuestionOption> options,
        @Size(max = 50) List<@Size(max = 100) String> tags,
        @Size(max = 200) List<@NotNull UUID> lectureIds) {}
