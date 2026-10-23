package ru.university.assistant.live.internal;

import java.util.UUID;

/** Local stream revocation sent only after the participation transaction commits. */
record ParticipantAccessRevoked(String joinCode, UUID personId) {}
