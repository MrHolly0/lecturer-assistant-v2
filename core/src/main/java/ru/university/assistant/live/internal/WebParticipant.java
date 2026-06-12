package ru.university.assistant.live.internal;

import java.util.UUID;
import ru.university.assistant.live.api.IdentityLevel;

record WebParticipant(UUID id, UUID sessionId, UUID personId, String displayName, IdentityLevel identityLevel) {}
