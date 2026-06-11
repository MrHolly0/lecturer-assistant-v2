package ru.university.assistant.iam.api;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        String invitationCode,
        @NotBlank @Size(min = 2, max = 200) String displayName,
        @NotBlank @Email String email,
        @NotBlank @Size(min = 8, max = 200) String password) {}
