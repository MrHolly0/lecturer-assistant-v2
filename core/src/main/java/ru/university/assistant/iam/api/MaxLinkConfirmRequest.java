package ru.university.assistant.iam.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record MaxLinkConfirmRequest(
        @NotBlank @Size(max = 8192) String initData,
        @NotBlank @Size(max = 128) String confirmationToken) {}
