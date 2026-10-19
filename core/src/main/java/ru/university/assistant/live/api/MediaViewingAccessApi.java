package ru.university.assistant.live.api;

import ru.university.assistant.iam.api.AuthenticatedUser;

/** Revalidates actual participation before each media signalling exchange. */
public interface MediaViewingAccessApi {
    ViewerAccess requireViewer(String joinCode, AuthenticatedUser user, String participantToken);
    record ViewerAccess(LiveSession session, java.util.UUID personId) {}
}
