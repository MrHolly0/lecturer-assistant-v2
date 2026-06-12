package ru.university.assistant.live.api;

import java.util.UUID;

public record StudentJoinResponse(
        String participantToken,
        UUID participantId,
        IdentityLevel identityLevel,
        StudentSessionSnapshot snapshot) {}
