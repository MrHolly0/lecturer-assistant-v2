package ru.university.assistant.iam.internal;

import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.university.assistant.iam.api.InvitationApi;
import ru.university.assistant.iam.api.InvitationResponse;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.shared.api.CodeGenerator;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class InvitationService implements InvitationApi {
    private final InvitationRepository invitations;
    private final Clock clock;

    InvitationService(InvitationRepository invitations, Clock clock) {
        this.invitations = invitations;
        this.clock = clock;
    }

    @Override
    @Transactional
    public InvitationResponse createInvitation(
            PersonRole role, UUID courseId, UUID groupId, UUID createdBy, Integer ttlHours) {
        int ttl = ttlHours == null ? 168 : ttlHours;
        return invitations.create(
                UuidV7.generate(),
                CodeGenerator.readableCode(10),
                role,
                courseId,
                groupId,
                createdBy,
                clock.instant().plus(Duration.ofHours(ttl)))
                .toResponse();
    }
}
