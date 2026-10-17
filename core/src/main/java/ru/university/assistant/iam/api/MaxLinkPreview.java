package ru.university.assistant.iam.api;

import java.time.Instant;

public record MaxLinkPreview(String confirmationToken, Instant expiresAt,
        UserProfile currentAccount, UserProfile targetAccount, boolean alreadyLinked) {}
