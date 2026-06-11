package ru.university.assistant.iam.api;

public record AuthResponse(String accessToken, String refreshToken, UserProfile user) {}
