package ru.university.assistant.iam.internal;

import java.security.SecureRandom;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.MaxLinkConfirmRequest;
import ru.university.assistant.iam.api.MaxLinkPreview;
import ru.university.assistant.iam.api.MaxLinkPreviewRequest;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.shared.api.UuidV7;

/** A short-lived review is separate from the single transaction that actually changes identity. */
@Service
public class MaxLinkService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcClient jdbc;
    private final IdentityRepository identities;
    private final PersonRepository persons;
    private final PasswordEncoder passwords;
    private final MaxInitDataValidator validator;
    private final AuthService auth;
    private final Clock clock;

    MaxLinkService(JdbcClient jdbc, IdentityRepository identities, PersonRepository persons,
            PasswordEncoder passwords, MaxInitDataValidator validator, AuthService auth, Clock clock) {
        this.jdbc = jdbc;
        this.identities = identities;
        this.persons = persons;
        this.passwords = passwords;
        this.validator = validator;
        this.auth = auth;
        this.clock = clock;
    }

    @Transactional
    public MaxLinkPreview preview(MaxLinkPreviewRequest request) {
        MaxInitData data = validate(request.initData());
        String externalId = Long.toString(data.userId());
        String code = request.linkCode() == null ? null : request.linkCode().trim().toUpperCase(java.util.Locale.ROOT);
        boolean byCode = code != null && !code.isEmpty();
        if (byCode == (request.email() != null || request.password() != null)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Provide credentials or a link code");
        }
        PersonRecord target;
        if (byCode) {
            UUID targetId = jdbc.sql("""
                    select person_id from iam.max_link_codes
                    where code = :code and used_at is null and expires_at > now()
                    """).param("code", code).query(UUID.class).optional().orElseThrow(() ->
                    identities.findMaxLinkCodeUsedAt(code).isPresent()
                            ? new ResponseStatusException(HttpStatus.CONFLICT, "Link code already used")
                            : new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid or expired link code"));
            target = active(targetId);
        } else {
            if (request.email() == null || request.password() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Email and password are required");
            }
            target = persons.findByEmail(request.email().trim()).orElseThrow(() ->
                    new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials"));
            if (!passwords.matches(request.password(), target.passwordHash())) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
            }
            active(target.id());
        }
        identities.lockExternalId("max", externalId);
        UUID currentId = currentPerson(externalId);
        lockPeople(target.id(), currentId);
        target = active(target.id());
        if (!byCode && !passwords.matches(request.password(), target.passwordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }
        boolean alreadyLinked = target.id().equals(currentId);
        if (!alreadyLinked && identities.existsForPerson(target.id(), "max")) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Target account already linked to MAX");
        }
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiry = clock.instant().plus(Duration.ofMinutes(2));
        jdbc.sql("""
                insert into iam.max_link_confirmations
                    (token_hash, external_id, target_person_id, current_person_id,
                     target_auth_version, current_auth_version, link_code, expires_at)
                values (:hash, :externalId, :target, :current, :targetVersion, :currentVersion, :code, :expiry)
                """)
                .param("hash", TokenHasher.sha256(token)).param("externalId", externalId)
                .param("target", target.id()).param("current", currentId, Types.OTHER)
                .param("targetVersion", version(target.id()))
                .param("currentVersion", currentId == null ? null : version(currentId), Types.BIGINT)
                .param("code", byCode ? code : null, Types.VARCHAR).param("expiry", Timestamp.from(expiry)).update();
        return new MaxLinkPreview(token, expiry,
                currentId == null ? null : persons.findById(currentId).orElseThrow().toProfile(),
                target.toProfile(), alreadyLinked);
    }

    @Transactional
    public AuthTokens confirm(MaxLinkConfirmRequest request) {
        MaxInitData data = validate(request.initData());
        String externalId = Long.toString(data.userId());
        identities.lockExternalId("max", externalId);
        Confirmation review = jdbc.sql("""
                select * from iam.max_link_confirmations
                where token_hash = :hash and external_id = :externalId
                    and used_at is null and expires_at > now() for update
                """).param("hash", TokenHasher.sha256(request.confirmationToken())).param("externalId", externalId)
                .query((rs, row) -> new Confirmation(rs.getObject("target_person_id", UUID.class),
                        rs.getObject("current_person_id", UUID.class), rs.getLong("target_auth_version"),
                        rs.getObject("current_auth_version", Long.class), rs.getString("link_code")))
                .optional().orElseThrow(MaxLinkService::reviewAgain);
        lockPeople(review.target(), review.current());
        UUID currentId = currentPerson(externalId);
        if (!Objects.equals(currentId, review.current()) || version(review.target()) != review.targetVersion()
                || (currentId != null && !Objects.equals(version(currentId), review.currentVersion()))) {
            throw reviewAgain();
        }
        PersonRecord target = active(review.target());
        if (!target.id().equals(currentId) && identities.existsForPerson(target.id(), "max")) throw reviewAgain();
        if (review.code() != null
                && identities.tryConsumeMaxLinkCode(review.code()).filter(target.id()::equals).isEmpty()) {
            throw reviewAgain();
        }
        if (currentId == null) {
            identities.createIdentity(UuidV7.generate(), target.id(), "max", externalId, data.username());
        } else if (!target.id().equals(currentId)) {
            identities.moveMaxIdentity(externalId, target.id(), data.username());
        }
        jdbc.sql("update iam.max_link_confirmations set used_at = now() where token_hash = :hash")
                .param("hash", TokenHasher.sha256(request.confirmationToken())).update();
        return auth.issueTokens(target);
    }

    @Scheduled(fixedDelay = 3_600_000)
    public void removeExpiredReviews() {
        jdbc.sql("delete from iam.max_link_confirmations where expires_at < now() - interval '1 day'").update();
    }

    private void lockPeople(UUID target, UUID current) {
        // Same order for concurrent moves and unlink; account updates also take these row locks.
        java.util.stream.Stream.of(target, current).filter(Objects::nonNull).distinct().sorted()
                .forEach(id -> identities.lockPersonChannel(id, "max"));
        java.util.stream.Stream.of(target, current).filter(Objects::nonNull).distinct().sorted()
                .forEach(id -> jdbc.sql("select id from iam.persons where id = :id for no key update")
                        .param("id", id).query(UUID.class).single());
    }

    private long version(UUID id) {
        return jdbc.sql("select auth_version from iam.persons where id = :id").param("id", id)
                .query(Long.class).optional().orElseThrow(MaxLinkService::reviewAgain);
    }

    private UUID currentPerson(String externalId) {
        return identities.findByExternalId("max", externalId).map(identity -> identity.personId()).orElse(null);
    }

    private PersonRecord active(UUID id) {
        PersonRecord person = persons.findById(id).orElseThrow(MaxLinkService::reviewAgain);
        if (person.status() != PersonStatus.ACTIVE) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "User is disabled");
        }
        return person;
    }

    private MaxInitData validate(String initData) {
        if (!validator.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "MAX login is not configured");
        }
        try {
            return validator.validate(initData);
        } catch (InvalidInitDataException exception) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid MAX initData");
        }
    }

    private static ResponseStatusException reviewAgain() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "Account changed or review expired; review again");
    }

    private record Confirmation(UUID target, UUID current, long targetVersion, Long currentVersion, String code) {}
}
