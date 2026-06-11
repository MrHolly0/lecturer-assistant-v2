package ru.university.assistant.org.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateStudyGroupRequest(@NotBlank @Size(min = 2, max = 100) String name) {}
