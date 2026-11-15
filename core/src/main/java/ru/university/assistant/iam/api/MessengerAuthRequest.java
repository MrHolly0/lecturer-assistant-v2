package ru.university.assistant.iam.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record MessengerAuthRequest(
        @NotBlank @Pattern(regexp = "telegram|vk") String channel,
        @NotBlank @Size(max = 8192) String initData,
        @Size(max = 64) String linkCode,
        boolean existingOnly) {}
