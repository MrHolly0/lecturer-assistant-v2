package ru.university.assistant.iam.internal;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.context.ApplicationEventPublisher;
import ru.university.assistant.iam.api.AccountAccessRevoked;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.ChangePasswordRequest;
import ru.university.assistant.iam.api.CreateInvitationRequest;
import ru.university.assistant.iam.api.EphemeralPersonApi;
import ru.university.assistant.iam.api.InvitationApi;
import ru.university.assistant.iam.api.InvitationResponse;
import ru.university.assistant.iam.api.LoginRequest;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.iam.api.RegisterRequest;
import ru.university.assistant.iam.api.UpdateUserRoleRequest;
import ru.university.assistant.iam.api.UpdateUserStatusRequest;
import ru.university.assistant.iam.api.UserPage;
import ru.university.assistant.iam.api.UserProfile;
import ru.university.assistant.iam.internal.security.JwtService;
import ru.university.assistant.org.api.CourseMembershipApi;
import ru.university.assistant.org.api.CourseRole;
import ru.university.assistant.org.api.StaffMembershipApi;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class AuthService implements EphemeralPersonApi {
    private static final String MAX_CHANNEL = "max";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final PersonRepository persons;
    private final ApplicationEventPublisher applicationEvents;
    private final IdentityRepository identities;
    private final MaxInitDataValidator maxInitData;
    private final InvitationRepository invitations;
    private final InvitationApi invitationApi;
    private final RefreshTokenRepository refreshTokens;
    private final CourseMembershipApi courseMemberships;
    private final StaffMembershipApi staffMemberships;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final EventBus events;
    private final Clock clock;
    private final Duration refreshTtl;

    AuthService(
            PersonRepository persons,
            IdentityRepository identities,
            MaxInitDataValidator maxInitData,
            InvitationRepository invitations,
            InvitationApi invitationApi,
            RefreshTokenRepository refreshTokens,
            CourseMembershipApi courseMemberships,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            EventBus events,
            Clock clock,
            @Value("${app.security.refresh-token-days}") long refreshTokenDays,
            StaffMembershipApi staffMemberships, ApplicationEventPublisher applicationEvents) {
        this.persons = persons;
        this.applicationEvents = applicationEvents;
        this.identities = identities;
        this.maxInitData = maxInitData;
        this.invitations = invitations;
        this.invitationApi = invitationApi;
        this.refreshTokens = refreshTokens;
        this.courseMemberships = courseMemberships;
        this.staffMemberships = staffMemberships;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.events = events;
        this.clock = clock;
        this.refreshTtl = Duration.ofDays(refreshTokenDays);
    }

    @Transactional
    public AuthTokens bootstrapAdmin(RegisterRequest request) {
        persons.lockAdminBootstrap();
        if (persons.countAdmins() > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Installation already has an admin");
        }
        PersonRecord person = createPerson(request, PersonRole.ADMIN);
        return issueTokens(person);
    }

    @Transactional
    public AuthTokens register(RegisterRequest request) {
        InvitationRecord invitation = invitations
                .findUsable(request.invitationCode())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid invitation"));
        PersonRecord person = createPerson(request, invitation.role());
        if (invitation.courseId() != null) {
            courseMemberships.addMemberFromInvitation(
                    invitation.courseId(), invitation.groupId(), person.id(), toCourseRole(invitation.role()));
        }
        if (invitation.organizationUnitId() != null) {
            staffMemberships.addInvitedStaff(person.id(), invitation.id());
        }
        if (!invitations.markUsed(invitation.id())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid invitation");
        }
        return issueTokens(person);
    }

    @Transactional
    public AuthTokens login(LoginRequest request) {
        PersonRecord person = persons
                .findByEmail(request.email())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials"));
        person = persons.lock(person.id());
        ensureActive(person);
        if (!passwordEncoder.matches(request.password(), person.passwordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }
        return issueTokens(person);
    }

    /**
     * Вход по initData мини-приложения MAX. Личность определяется только подписанным user.id:
     * повторный вход находит того же человека и берёт его роль. Явно предъявленный
     * код привязки требует отдельного preview/confirm с явным подтверждением.
     */
    @Transactional
    public AuthTokens loginWithMax(String initData, String linkCode, String startParam, boolean existingOnly) {
        if (!maxInitData.isConfigured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "MAX login is not configured");
        }
        MaxInitData data;
        try {
            data = maxInitData.validate(initData);
        } catch (InvalidInitDataException exception) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid MAX initData");
        }
        if (linkCode != null && !linkCode.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Review the account before linking MAX");
        }
        String externalId = Long.toString(data.userId());
        identities.lockExternalId(MAX_CHANNEL, externalId);
        Optional<PersonRecord> existingPerson = identities
                .findByExternalId(MAX_CHANNEL, externalId)
                .flatMap(identity -> persons.findById(identity.personId()));
        if (existingOnly && existingPerson.isEmpty() && (linkCode == null || linkCode.isBlank())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "MAX account is not linked");
        }
        PersonRecord person = existingPerson.orElseGet(() -> createMaxStudent(data, externalId));
        String normalizedStartParam = startParam == null ? "" : startParam.trim().toUpperCase();
        Map<String, Object> context = normalizedStartParam.isEmpty()
                ? Map.of()
                : Map.of("startParam", normalizedStartParam);
        events.publish(new DomainEvent(
                "miniapp.session",
                person.id(),
                "miniapp.opened",
                person.id(),
                context,
                Map.of("platform", "MAX")));
        return issueTokens(person);
    }

    private PersonRecord createMaxStudent(MaxInitData data, String externalId) {
        UUID personId = UuidV7.generate();
        PersonRecord person = persons.create(
                personId,
                maxDisplayName(data),
                "max-" + externalId + "@max.local",
                passwordEncoder.encode(randomToken()),
                PersonRole.STUDENT);
        identities.createIdentity(UuidV7.generate(), personId, MAX_CHANNEL, externalId, data.username());
        return person;
    }

    private static String maxDisplayName(MaxInitData data) {
        String name = ((data.firstName() == null ? "" : data.firstName()) + " "
                        + (data.lastName() == null ? "" : data.lastName()))
                .trim();
        if (name.isEmpty()) {
            name = data.username() == null ? "" : data.username().trim();
        }
        return name.isEmpty() ? "Студент MAX" : name;
    }

    @Transactional
    public AuthTokens refresh(String refreshToken) {
        String hash = TokenHasher.sha256(refreshToken);
        UUID personId = refreshTokens.ownerOfUsable(hash)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid refresh token"));
        // All authentication mutations take person -> credential locks in this order.
        // A concurrent password/role change cannot leave a newly rotated cookie unrevoked.
        PersonRecord person = persons.lock(personId);
        refreshTokens.consume(hash).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid refresh token"));
        ensureActive(person);
        return issueTokens(person);
    }

    @Transactional
    public void logout(String refreshToken) {
        refreshTokens.revoke(TokenHasher.sha256(refreshToken));
    }

    @Transactional
    public void changePassword(AuthenticatedUser user, ChangePasswordRequest request) {
        PersonRecord person = persons.lock(user.id());
        if (!passwordEncoder.matches(request.currentPassword(), person.passwordHash())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Current password is invalid");
        }
        persons.updatePassword(user.id(), passwordEncoder.encode(request.newPassword()));
        revokeAccount(user.id());
    }

    public UserProfile currentUser(AuthenticatedUser user) {
        return persons.findById(user.id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"))
                .toProfile();
    }

    @Override
    @Transactional
    public UserProfile createEphemeralStudent(String displayName) {
        UUID personId = UuidV7.generate();
        String cleanName = displayName == null || displayName.trim().length() < 2
                ? "Гость " + personId.toString().substring(28)
                : displayName.trim();
        return persons.createWithStatus(
                        personId,
                        cleanName,
                        "web-" + personId + "@ephemeral.local",
                        passwordEncoder.encode(randomToken()),
                        PersonRole.STUDENT,
                        PersonStatus.EPHEMERAL)
                .toProfile();
    }

    @Override
    @Transactional
    public void updateStudentDisplayName(UUID personId, String displayName) {
        persons.updateStudentDisplayName(personId, displayName);
    }

    public List<UserProfile> listUsers() {
        return persons.list().stream()
                .filter(person -> person.status() != PersonStatus.EPHEMERAL)
                .map(PersonRecord::toProfile)
                .toList();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public UserPage pageUsers(String query, PersonRole role, PersonStatus status, int limit, int offset) {
        if (query != null && query.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Search query must be at most 200 characters");
        }
        query = query == null || query.isBlank() ? null : query.trim();
        if (status == PersonStatus.EPHEMERAL) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "EPHEMERAL status is system-managed");
        }
        if (limit < 1 || limit > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limit must be between 1 and 100");
        }
        if (offset < 0 || offset > 1_000_000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Offset must be between 0 and 1000000");
        }
        return persons.pageUsers(query, role, status, limit, offset);
    }

    @Transactional
    public UserProfile updateUserRole(
            AuthenticatedUser actor, UUID personId, UpdateUserRoleRequest request) {
        if (actor.id().equals(personId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot change your own role");
        }
        PersonRecord current = lockAccountAdministration(actor, personId);
        if (current.role() == request.role()) return current.toProfile();
        protectLastAdmin(current, request.role(), current.status());
        UserProfile updated = persons.updateRole(personId, request.role()).toProfile();
        revokeAccount(personId);
        if (request.role() == PersonRole.STUDENT) {
            staffMemberships.removeStaffMembershipIfStudent(personId);
        }
        return updated;
    }

    @Transactional
    public UserProfile updateUserStatus(
            AuthenticatedUser actor, UUID personId, UpdateUserStatusRequest request) {
        if (actor.id().equals(personId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot change your own status");
        }
        if (request.status() == PersonStatus.EPHEMERAL) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "EPHEMERAL status is system-managed");
        }
        PersonRecord current = lockAccountAdministration(actor, personId);
        if (current.status() == request.status()) return current.toProfile();
        protectLastAdmin(current, current.role(), request.status());
        UserProfile updated = persons.updateStatus(personId, request.status()).toProfile();
        revokeAccount(personId);
        return updated;
    }

    private PersonRecord lockAccountAdministration(AuthenticatedUser actor, UUID personId) {
        persons.lockAdminBootstrap();
        PersonRecord administrator = persons.findById(actor.id()).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.FORBIDDEN, "Administrator access required"));
        if (administrator.role() != PersonRole.ADMIN || administrator.status() != PersonStatus.ACTIVE) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Administrator access required");
        }
        return persons.findById(personId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    }

    private void protectLastAdmin(PersonRecord current, PersonRole role, PersonStatus status) {
        if (current.role() == PersonRole.ADMIN && current.status() == PersonStatus.ACTIVE
                && (role != PersonRole.ADMIN || status != PersonStatus.ACTIVE) && persons.countActiveAdmins() <= 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The last active administrator must remain");
        }
    }

    private void revokeAccount(UUID personId) {
        identities.revokeLinkCodes(personId);
        refreshTokens.revokeForPerson(personId);
        applicationEvents.publishEvent(new AccountAccessRevoked(personId));
    }

    @Transactional
    public InvitationResponse createAdminInvitation(AuthenticatedUser createdBy, CreateInvitationRequest request) {
        if (request.role() == PersonRole.STUDENT) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Student invitations are course-scoped");
        }
        staffMemberships.validateInvitationTarget(request.organizationUnitId());
        return invitationApi.createInvitation(
                request.role(), null, null, request.organizationUnitId(), createdBy.id(), request.ttlHours());
    }

    private PersonRecord createPerson(RegisterRequest request, PersonRole role) {
        return persons.create(
                UuidV7.generate(),
                request.displayName().trim(),
                request.email().trim(),
                passwordEncoder.encode(request.password()),
                role);
    }

    AuthTokens issueTokens(PersonRecord person) {
        person = persons.lock(person.id());
        ensureActive(person);
        AuthenticatedUser user = new AuthenticatedUser(
                person.id(), person.displayName(), person.email(), person.role());
        String refreshToken = randomToken();
        refreshTokens.create(
                UuidV7.generate(), person.id(), TokenHasher.sha256(refreshToken), Instant.now(clock).plus(refreshTtl));
        return new AuthTokens(jwtService.issue(user), refreshToken, person.toProfile(), jwtService.accessTtlSeconds());
    }

    private void ensureActive(PersonRecord person) {
        if (person.status() != PersonStatus.ACTIVE) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "User is disabled");
        }
    }

    private CourseRole toCourseRole(PersonRole role) {
        return switch (role) {
            case LECTURER -> CourseRole.LECTURER;
            case ASSISTANT -> CourseRole.ASSISTANT;
            case STUDENT -> CourseRole.STUDENT;
            case ADMIN -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Admin cannot join a course");
        };
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
