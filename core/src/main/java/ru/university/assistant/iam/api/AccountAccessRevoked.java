package ru.university.assistant.iam.api;

import java.util.UUID;

/** Published in the account transaction; subscribers act only after its commit. */
public record AccountAccessRevoked(UUID personId) {}
