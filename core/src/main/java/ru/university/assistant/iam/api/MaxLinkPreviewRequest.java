package ru.university.assistant.iam.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record MaxLinkPreviewRequest(
        @NotBlank @Size(max = 8192) String initData,
        @Size(max = 254) String email, @Size(max = 200) String password, @Size(max = 32) String linkCode) {}
