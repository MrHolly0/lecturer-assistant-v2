package ru.university.assistant.iam.api;

import java.util.UUID;

public record UserProfile(UUID id, String displayName, String email, PersonRole role, PersonStatus status) {}
