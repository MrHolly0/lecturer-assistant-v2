package ru.university.assistant.iam.api;

import java.util.Optional;

/** Validates an opaque credential for quota accounting only. This never authorizes a request. */
public interface CredentialQuotaSubjectApi {
    String headerName();
    boolean supports(String requestPath);
    Optional<String> findSubject(String requestPath, String credential);
}
