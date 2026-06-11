package ru.university.assistant.org.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateCourseRequest(@NotBlank @Size(min = 2, max = 200) String title) {}
