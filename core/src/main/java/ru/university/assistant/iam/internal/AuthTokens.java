package ru.university.assistant.iam.internal;

import ru.university.assistant.iam.api.AuthResponse;
import ru.university.assistant.iam.api.MaxAuthResponse;
import ru.university.assistant.iam.api.UserProfile;

public record AuthTokens(String accessToken, String refreshToken, UserProfile user, long expiresInSeconds) {
    public AuthResponse toResponse() {
        return new AuthResponse(accessToken, user);
    }

    public MaxAuthResponse toMaxResponse() {
        return new MaxAuthResponse(accessToken, expiresInSeconds, user.role(), user.id(), user.displayName());
    }
}
