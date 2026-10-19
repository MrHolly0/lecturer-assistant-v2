package ru.university.assistant.iam.api;

/** Optional, revocable non-account credentials that authorize only a bounded request scope. */
public interface ScopedRequestAuthenticationApi {
    String headerName();

    AuthenticatedUser authenticate(String method, String requestPath, String credential);
}
