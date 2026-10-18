package ru.university.assistant.iam.api;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Current account state, including revocation, shared without exposing IAM repositories. */
public interface AccountStateApi {
    Optional<State> find(UUID personId);

    /** Locks the account row until the caller's transaction completes. */
    Optional<State> lock(UUID personId);

    Optional<State> findActiveByEmail(String email);

    Set<UUID> enabledPeople(Set<UUID> personIds);

    record State(UUID id, String displayName, String email, PersonRole role, PersonStatus status, long version) {}
}
