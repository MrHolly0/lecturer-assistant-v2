package ru.university.assistant.iam.api;

import java.util.UUID;

public record MaxAuthResponse(
        String accessToken, long expiresIn, PersonRole role, UUID personId, String displayName) {}
