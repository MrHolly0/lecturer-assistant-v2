package ru.university.assistant.iam.api;

import java.util.Optional;

public interface TokenAuthenticationApi {
    Optional<AuthenticatedUser> parseAccessToken(String token);
}
