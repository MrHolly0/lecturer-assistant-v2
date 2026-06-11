package ru.university.assistant.iam.api;

import jakarta.validation.constraints.NotBlank;

public record LinkIdentityRequest(
        @NotBlank String code, @NotBlank String channelType, @NotBlank String externalId, String displayHint) {}
