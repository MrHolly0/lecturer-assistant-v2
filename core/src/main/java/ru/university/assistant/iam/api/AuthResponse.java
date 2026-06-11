package ru.university.assistant.iam.api;

public record AuthResponse(String accessToken, UserProfile user) {}
