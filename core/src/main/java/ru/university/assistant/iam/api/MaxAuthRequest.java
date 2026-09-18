package ru.university.assistant.iam.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record MaxAuthRequest(@NotBlank @Size(max = 8192) String initData) {}
