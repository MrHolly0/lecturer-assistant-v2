package ru.university.assistant.iam.api;

import java.time.Instant;

public record IdentityLinkCodeResponse(String code, Instant expiresAt) {}
