package ru.university.assistant.interaction.api;

import java.util.UUID;

/** Session lifecycle hooks for polls, invoked inside the session transaction and lock. */
public interface SessionPollLifecycleApi {
    void closeOpenForSession(UUID courseId, UUID sessionId, UUID closedBy);
}
