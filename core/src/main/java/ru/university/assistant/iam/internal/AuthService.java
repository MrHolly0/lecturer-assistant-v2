package ru.university.assistant.iam.internal;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.ChangePasswordRequest;
import ru.university.assistant.iam.api.CreateInvitationRequest;
import ru.university.assistant.iam.api.InvitationApi;
import ru.university.assistant.iam.api.InvitationResponse;
import ru.university.assistant.iam.api.LoginRequest;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.PersonStatus;
import ru.university.assistant.iam.api.RegisterRequest;
import ru.university.assistant.iam.api.UpdateUserRoleRequest;
import ru.university.assistant.iam.api.UpdateUserStatusRequest;
import ru.university.assistant.iam.api.UserProfile;
import ru.university.assistant.iam.internal.security.JwtService;
import ru.university.assistant.org.api.CourseMembershipApi;
import ru.university.assistant.org.api.CourseRole;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class AuthService {
    private static final SecureRandom RANDOM = new SecureRandom();

    private final PersonRepository persons;
    private final InvitationRepository invitations;
    private final InvitationApi invitationApi;
    private final RefreshTokenRepository refreshTokens;
    private final CourseMembershipApi courseMemberships;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final Clock clock;
    private final Duration refreshTtl;

    AuthService(
            PersonRepository persons,
            InvitationRepository invitations,
            InvitationApi invitationApi,
            RefreshTokenRepository refreshTokens,
            CourseMembershipApi courseMemberships,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            Clock clock,
            @Value("${app.security.refresh-token-days}") long refreshTokenDays) {
        this.persons = persons;
        this.invitations = invitations;
        this.invitationApi = invitationApi;
        this.refreshTokens = refreshTokens;
        this.courseMemberships = courseMemberships;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.clock = clock;
        this.refreshTtl = Duration.ofDays(refreshTokenDays);
    }

    @Transactional
    public AuthTokens bootstrapAdmin(RegisterRequest request) {
        if (persons.count() > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Installation already has users");
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
        invitations.markUsed(invitation.id());
        return issueTokens(person);
    }

    @Transactional
    public AuthTokens login(LoginRequest request) {
        PersonRecord person = persons
                .findByEmail(request.email())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials"));
        ensureActive(person);
        if (!passwordEncoder.matches(request.password(), person.passwordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }
        return issueTokens(person);
    }

    @Transactional
    public AuthTokens refresh(String refreshToken) {
        String hash = TokenHasher.sha256(refreshToken);
        UUID personId = refreshTokens
                .findUsablePersonId(hash)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid refresh token"));
        refreshTokens.revoke(hash);
        PersonRecord person = persons
                .findById(personId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid refresh token"));
        ensureActive(person);
        return issueTokens(person);
    }

    @Transactional
    public void logout(String refreshToken) {
        refreshTokens.revoke(TokenHasher.sha256(refreshToken));
    }

    @Transactional
    public void changePassword(AuthenticatedUser user, ChangePasswordRequest request) {
        PersonRecord person = persons
                .findById(user.id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
        if (!passwordEncoder.matches(request.currentPassword(), person.passwordHash())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Current password is invalid");
        }
        persons.updatePassword(user.id(), passwordEncoder.encode(request.newPassword()));
    }

    public UserProfile currentUser(AuthenticatedUser user) {
        return persons.findById(user.id())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"))
                .toProfile();
    }

    public List<UserProfile> listUsers() {
        return persons.list().stream().map(PersonRecord::toProfile).toList();
    }

    @Transactional
    public UserProfile updateUserRole(
            AuthenticatedUser actor, UUID personId, UpdateUserRoleRequest request) {
        if (actor.id().equals(personId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot change your own role");
        }
        return persons.updateRole(personId, request.role()).toProfile();
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
        return persons.updateStatus(personId, request.status()).toProfile();
    }

    @Transactional
    public InvitationResponse createAdminInvitation(AuthenticatedUser createdBy, CreateInvitationRequest request) {
        if (request.role() == PersonRole.STUDENT) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Student invitations are course-scoped");
        }
        return invitationApi.createInvitation(request.role(), null, null, createdBy.id(), request.ttlHours());
    }

    private PersonRecord createPerson(RegisterRequest request, PersonRole role) {
        return persons.create(
                UuidV7.generate(),
                request.displayName().trim(),
                request.email().trim(),
                passwordEncoder.encode(request.password()),
                role);
    }

    private AuthTokens issueTokens(PersonRecord person) {
        ensureActive(person);
        AuthenticatedUser user = new AuthenticatedUser(
                person.id(), person.displayName(), person.email(), person.role());
        String refreshToken = randomToken();
        refreshTokens.create(
                UuidV7.generate(), person.id(), TokenHasher.sha256(refreshToken), Instant.now(clock).plus(refreshTtl));
        return new AuthTokens(jwtService.issue(user), refreshToken, person.toProfile());
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
