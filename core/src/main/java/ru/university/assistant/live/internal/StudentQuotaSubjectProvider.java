package ru.university.assistant.live.internal;

import java.util.Optional;
import org.springframework.stereotype.Component;
import ru.university.assistant.iam.api.CredentialQuotaSubjectApi;

@Component
class StudentQuotaSubjectProvider implements CredentialQuotaSubjectApi {
    private final LiveSessionRepository sessions;
    StudentQuotaSubjectProvider(LiveSessionRepository sessions) { this.sessions = sessions; }
    @Override public String headerName() { return "X-Participant-Token"; }
    @Override public boolean supports(String path) { return path.startsWith("/api/v1/student/sessions/"); }
    @Override public Optional<String> findSubject(String path, String credential) {
        return sessions.findWebParticipant(StudentTokenHasher.sha256(credential))
                .map(participant -> "person:" + participant.personId());
    }
}
