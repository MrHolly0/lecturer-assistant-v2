package ru.university.assistant.iam.internal;

import java.time.Clock;
import java.time.Duration;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.ChannelIdentityApi;
import ru.university.assistant.iam.api.ChannelIdentityResponse;
import ru.university.assistant.iam.api.IdentityLinkCodeResponse;
import ru.university.assistant.iam.api.LinkIdentityRequest;
import ru.university.assistant.shared.api.CodeGenerator;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class IdentityService implements ChannelIdentityApi {
    private final IdentityRepository identities;
    private final Clock clock;

    IdentityService(IdentityRepository identities, Clock clock) {
        this.identities = identities;
        this.clock = clock;
    }

    @Transactional
    public IdentityLinkCodeResponse createLinkCode(AuthenticatedUser user) {
        String code = CodeGenerator.readableCode(8);
        var expiresAt = clock.instant().plus(Duration.ofMinutes(15));
        identities.createLinkCode(UuidV7.generate(), user.id(), code, expiresAt);
        return new IdentityLinkCodeResponse(code, expiresAt);
    }

    @Transactional
    public ChannelIdentityResponse link(LinkIdentityRequest request) {
        String channelType = request.channelType().toLowerCase();
        if (!channelType.equals("telegram")
                && !channelType.equals("vk")
                && !channelType.equals("web")
                && !channelType.equals("echo")
                && !channelType.equals("max")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported channel type");
        }
        var personId = identities
                .findUsablePersonIdByCode(request.code())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid link code"));
        ChannelIdentityResponse identity = identities.createIdentity(
                UuidV7.generate(), personId, channelType, request.externalId(), request.displayHint());
        identities.markLinkCodeUsed(request.code());
        return identity;
    }

    @Override
    public boolean hasIdentity(java.util.UUID personId, String channelType) {
        return identities.existsForPerson(personId, channelType.toLowerCase());
    }

    @Override
    public Optional<ChannelIdentityResponse> findByExternalId(String channelType, String externalId) {
        return identities.findByExternalId(channelType.toLowerCase(), externalId);
    }
}
