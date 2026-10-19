package ru.university.assistant.live.api;

import java.util.UUID;

/** Committed state boundary for short-lived public media buffers. */
public record SessionStateChanged(UUID sessionId, SessionStatus status) {}
