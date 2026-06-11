package ru.university.assistant.iam.internal;

import ru.university.assistant.iam.api.AuthResponse;
import ru.university.assistant.iam.api.UserProfile;

public record AuthTokens(String accessToken, String refreshToken, UserProfile user) {
    public AuthResponse toResponse() {
        return new AuthResponse(accessToken, user);
    }
}
