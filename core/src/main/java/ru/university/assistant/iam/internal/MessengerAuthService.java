package ru.university.assistant.iam.internal;

import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.MessengerAuthRequest;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class MessengerAuthService {
    private final boolean enabled;
    private final MessengerLaunchValidator validator;
    private final IdentityRepository identities;
    private final PersonRepository persons;
    private final AuthService auth;

    MessengerAuthService(@Value("${app.experimental.messenger-login:false}") boolean enabled,
            MessengerLaunchValidator validator, IdentityRepository identities, PersonRepository persons,
            AuthService auth) {
        this.enabled = enabled;
        this.validator = validator;
        this.identities = identities;
        this.persons = persons;
        this.auth = auth;
    }

    @Transactional
    public AuthTokens login(MessengerAuthRequest request) {
        if (!enabled) throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                "Вход через этот мессенджер пока не включён администратором");
        var launch = validator.validate(request.channel(), request.initData());
        identities.lockExternalId(launch.channel(), launch.externalId());
        var identity = identities.findByExternalId(launch.channel(), launch.externalId());
        PersonRecord person;
        if (request.linkCode() != null && !request.linkCode().isBlank()) {
            UUID target = identities.consumeLinkCode(request.linkCode().trim().toUpperCase())
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Код подключения недействителен или уже использован"));
            person = persons.lock(target);
            if (identity.isPresent() && !identity.get().personId().equals(target)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Мессенджер уже подключён к другому аккаунту");
            }
            if (identity.isEmpty()) {
                if (identities.existsForPerson(target, launch.channel())) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "К этому аккаунту уже подключён другой профиль мессенджера");
                }
                identities.createIdentity(UuidV7.generate(), target, launch.channel(), launch.externalId(),
                        launch.displayName());
            }
        } else if (identity.isPresent()) {
            person = persons.lock(identity.get().personId());
        } else {
            if (request.existingOnly()) {
                throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                        "Аккаунт мессенджера ещё не подключён");
            }
            UUID id = UuidV7.generate();
            person = persons.create(id, launch.displayName(), launch.channel() + "-" + id + "@messenger.local",
                    AuthService.NO_PASSWORD, PersonRole.STUDENT);
            identities.createIdentity(UuidV7.generate(), id, launch.channel(), launch.externalId(),
                    launch.displayName());
        }
        return auth.issueTokens(person);
    }
}
