package ru.university.assistant.live.internal;

import org.springframework.stereotype.Service;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.MediaViewingAccessApi;

@Service
class MediaViewingAccessService implements MediaViewingAccessApi {
    private final StudentWebSessionService students;
    MediaViewingAccessService(StudentWebSessionService students) { this.students = students; }
    @Override
    public ViewerAccess requireViewer(String joinCode, AuthenticatedUser user, String participantToken) {
        return students.requireMediaViewer(joinCode, user, participantToken);
    }
}
