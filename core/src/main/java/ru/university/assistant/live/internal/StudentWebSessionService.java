package ru.university.assistant.live.internal;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.channel.api.ChannelFanoutApi;
import ru.university.assistant.content.api.StudentDeckApi;
import ru.university.assistant.feedback.api.FeedbackApi;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.ChannelIdentityApi;
import ru.university.assistant.iam.api.EphemeralPersonApi;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.UserProfile;
import ru.university.assistant.live.api.IdentityLevel;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionParticipant;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StudentEngagement;
import ru.university.assistant.live.api.StudentJoinRequest;
import ru.university.assistant.live.api.StudentJoinResponse;
import ru.university.assistant.live.api.StudentNameRequest;
import ru.university.assistant.live.api.StudentQuestionRequest;
import ru.university.assistant.live.api.StudentSessionSnapshot;
import ru.university.assistant.live.api.StudentSignalRequest;
import ru.university.assistant.live.api.UpdateStudentQuestionRequest;
import ru.university.assistant.org.api.CourseMembershipApi;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.org.api.GroupSelectionRequiredException;
import ru.university.assistant.org.api.StudyGroup;
import ru.university.assistant.interaction.api.ActivityRespondApi;
import ru.university.assistant.interaction.api.ActivityResponse;
import ru.university.assistant.interaction.api.PollVote;
import ru.university.assistant.interaction.api.QuickPollApi;
import ru.university.assistant.interaction.api.SubmitActivityResponseRequest;
import ru.university.assistant.qa.api.QuestionApi;
import ru.university.assistant.qa.api.ResolvedQuestion;
import ru.university.assistant.qa.api.StudentQuestion;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class StudentWebSessionService {
    private static final SecureRandom RANDOM = new SecureRandom();

    private final LiveSessionRepository sessions;
    private final StudentSessionSnapshotService snapshots;
    private final FeedbackApi feedback;
    private final QuestionApi questions;
    private final EphemeralPersonApi persons;
    private final ChannelIdentityApi channelIdentities;
    private final CourseMembershipApi memberships;
    private final CourseAccessApi courseAccess;
    private final EventBus events;
    private final LiveSessionPublisher publisher;
    private final QuickPollApi quickPolls;
    private final ActivityRespondApi activityRespond;
    private final ApplicationEventPublisher applicationEvents;
    private final ChannelFanoutApi channelFanout;
    private final StudentDeckApi studentDecks;

    StudentWebSessionService(
            LiveSessionRepository sessions,
            StudentSessionSnapshotService snapshots,
            FeedbackApi feedback,
            QuestionApi questions,
            EphemeralPersonApi persons,
            ChannelIdentityApi channelIdentities,
            CourseMembershipApi memberships,
            CourseAccessApi courseAccess,
            EventBus events,
            LiveSessionPublisher publisher,
            QuickPollApi quickPolls,
            ActivityRespondApi activityRespond,
            ApplicationEventPublisher applicationEvents,
            ChannelFanoutApi channelFanout,
            StudentDeckApi studentDecks) {
        this.sessions = sessions;
        this.snapshots = snapshots;
        this.feedback = feedback;
        this.questions = questions;
        this.persons = persons;
        this.channelIdentities = channelIdentities;
        this.memberships = memberships;
        this.courseAccess = courseAccess;
        this.events = events;
        this.publisher = publisher;
        this.quickPolls = quickPolls;
        this.activityRespond = activityRespond;
        this.applicationEvents = applicationEvents;
        this.channelFanout = channelFanout;
        this.studentDecks = studentDecks;
    }

    public StudentSessionSnapshot snapshot(String joinCode) {
        LiveSession session = sessionByCode(joinCode);
        return snapshots.create(session, null, false);
    }

    public Optional<String> activeJoinCodeFor(AuthenticatedUser user) {
        return sessions.findActiveJoinCodeForParticipant(user.id());
    }

    /** Снапшот с личными полями студента. Идентификация необязательна: без неё это общий снапшот. */
    public StudentSessionSnapshot snapshot(String joinCode, AuthenticatedUser user, String participantToken) {
        LiveSession session = sessionByCode(joinCode);
        UUID viewer = viewerId(session, user, participantToken);
        return snapshots.create(session, viewer, true);
    }

    StudentSessionSnapshot snapshotForViewer(String joinCode, UUID viewerPersonId) {
        LiveSession session = sessionByCode(joinCode);
        return snapshots.create(session, viewerPersonId, false);
    }

    Map<UUID, StudentSessionSnapshot> snapshotsForViewers(String joinCode, Set<UUID> viewerPersonIds) {
        LiveSession session = sessionByCode(joinCode);
        return snapshots.createForViewers(session, viewerPersonIds);
    }

    private UUID viewerId(LiveSession session, AuthenticatedUser user, String participantToken) {
        if (participantToken != null && !participantToken.isBlank()) {
            return sessions.findWebParticipant(StudentTokenHasher.sha256(participantToken))
                    .filter(participant -> participant.sessionId().equals(session.id()))
                    .map(WebParticipant::personId)
                    .orElse(null);
        }
        return user == null ? null : user.id();
    }

    @Transactional
    public StudentJoinResponse join(String joinCode, StudentJoinRequest request, AuthenticatedUser user) {
        LiveSession session = sessionByCode(joinCode);
        ensureJoinable(session);
        String presented = request == null ? null : request.participantToken();
        if (presented != null && !presented.isBlank()) {
            WebParticipant existing = sessions.findWebParticipant(StudentTokenHasher.sha256(presented))
                    .filter(participant -> participant.sessionId().equals(session.id()))
                    .orElse(null);
            if (existing != null) {
                if (user != null && existing.identityLevel() == IdentityLevel.EPHEMERAL) {
                    SessionParticipant guest = sessions.lockGuestParticipation(session.id(), existing.personId())
                            .orElseThrow(() -> {
                                return new ResponseStatusException(
                                        HttpStatus.CONFLICT, "Guest session was already claimed");
                            });
                    requireActive(session.id(), guest.personId());
                    registerPerson(session, user, guest.groupId());
                    sessions.claimGuestParticipation(session.id(), guest.personId(), user.id(), guest.displayName());
                    if (!guest.displayName().startsWith("Гость ")) {
                        persons.updateStudentDisplayName(user.id(), guest.displayName());
                    }
                    publisher.publish("participant.claimed", session);
                    return issueProfileJoin(session, user);
                }
                if (user != null && !existing.personId().equals(user.id())) {
                    String reason = "Participant token belongs to another person";
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, reason);
                }
                requireActive(session.id(), existing.personId());
                sessions.touchWebParticipant(existing.id());
                return new StudentJoinResponse(
                        presented,
                        existing.id(),
                        existing.identityLevel(),
                        snapshots.create(session, existing.personId(), true));
            }
        }
        if (user != null) {
            boolean rejoined = sessions.clearKickForRejoin(session.id(), user.id());
            registerPerson(session, user, request == null ? null : request.groupId());
            if (rejoined) {
                events.publish(new DomainEvent("live.session", session.id(), "participant.rejoined", user.id(),
                        Map.of("courseId", session.courseId(), "sessionId", session.id()), Map.of()));
                publisher.publish("participant.rejoined", session);
            }
            return issueProfileJoin(session, user);
        }
        UserProfile person = persons.createEphemeralStudent(request == null ? null : request.displayName());
        StudyGroup group = selectSessionGroup(session, request == null ? null : request.groupId());
        // Гость живёт только в сессии: в постоянный состав курса он не попадает (D-14).
        publishJoined(
                session,
                person.id(),
                sessions.joinPerson(session.id(), person.id(), person.displayName(), group),
                IdentityLevel.EPHEMERAL,
                "web",
                group);
        String token = randomToken();
        WebParticipant participant = sessions.createWebToken(
                UuidV7.generate(), session.id(), person.id(),
                StudentTokenHasher.sha256(token), person.displayName(), IdentityLevel.EPHEMERAL);
        return new StudentJoinResponse(
                token,
                participant.id(),
                participant.identityLevel(),
                snapshots.create(session, person.id(), true));
    }

    private StudentJoinResponse issueProfileJoin(LiveSession session, AuthenticatedUser user) {
        sessions.deleteProfileTokens(session.id(), user.id());
        String token = randomToken();
        WebParticipant participant = sessions.createWebToken(
                UuidV7.generate(), session.id(), user.id(),
                StudentTokenHasher.sha256(token), user.displayName(), IdentityLevel.PROFILE);
        return new StudentJoinResponse(
                token, participant.id(), IdentityLevel.PROFILE, snapshots.create(session, user.id(), true));
    }

    /** Реальный человек (вход через MAX или по паролю): один участник сессии, студент курса добавляется один раз. */
    private void registerPerson(LiveSession session, AuthenticatedUser user, UUID requestedGroupId) {
        StudyGroup group;
        if (user.role() == PersonRole.STUDENT) {
            group = memberships.ensureStudentMemberInSessionGroups(
                    session.courseId(), user.id(), studyGroups(session), requestedGroupId);
        } else {
            group = selectSessionGroup(session, requestedGroupId);
        }
        LiveSessionRepository.JoinOutcome outcome =
                sessions.joinPerson(session.id(), user.id(), user.displayName(), group);
        if (outcome.kicked()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Вас удалили из этой лекции");
        }
        String origin = channelIdentities.hasIdentity(user.id(), "max") ? "max" : "web";
        publishJoined(session, user.id(), outcome, IdentityLevel.PROFILE, origin, group);
    }

    private void publishJoined(
            LiveSession session, UUID personId, LiveSessionRepository.JoinOutcome outcome,
            IdentityLevel level, String origin, StudyGroup group) {
        if (!outcome.inserted()) {
            return;
        }
        events.publish(new DomainEvent(
                "live.session",
                session.id(),
                "participant.joined",
                personId,
                Map.of(
                        "courseId", session.courseId(),
                        "sessionId", session.id(),
                        "lectureId", session.lectureId(),
                        "groupId", group.id()),
                Map.of(
                        "channelType", "web",
                        "identityLevel", level.name(),
                        "origin", origin,
                        "groupName", group.name())));
        publisher.publish("participant.joined", session);
    }

    @Transactional
    public SignalAggregate signal(String joinCode, StudentSignalRequest request, AuthenticatedUser user) {
        ParticipantSession current = participantSession(joinCode, request.participantToken(), user);
        ensureInteractive(current.session());
        SignalAggregate aggregate = feedback.saveSignal(
                current.session().id(), current.participant().personId(), "web",
                current.session().currentSlideIdx(), request.value());
        touch(current.participant());
        publisher.publish("feedback.signal_submitted", current.session());
        return aggregate;
    }

    @Transactional
    public StudentQuestion ask(String joinCode, StudentQuestionRequest request, AuthenticatedUser user) {
        ParticipantSession current = participantSession(joinCode, request.participantToken(), user);
        ensureInteractive(current.session());
        StudentQuestion question = questions.ask(
                current.session().id(),
                current.participant().personId(),
                current.participant().displayName(),
                "web",
                request.text());
        touch(current.participant());
        publisher.publish("qa.question_asked", current.session());
        return question;
    }

    public StudentEngagement engagement(AuthenticatedUser user, UUID courseId, UUID sessionId) {
        courseAccess.requireManage(user, courseId);
        LiveSession session = sessions.findByCourse(courseId, sessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found"));
        return new StudentEngagement(
                feedback.aggregate(sessionId, session.currentSlideIdx()),
                feedback.problemSlides(sessionId),
                questions.openQuestions(sessionId));
    }

    @Transactional
    public StudentQuestion updateQuestion(
            AuthenticatedUser user,
            UUID courseId,
            UUID sessionId,
            UUID questionId,
            UpdateStudentQuestionRequest request) {
        courseAccess.requireManage(user, courseId);
        LiveSession session = sessions.findByCourse(courseId, sessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found"));
        if (session.status() != SessionStatus.LIVE && session.status() != SessionStatus.PAUSED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Session is not running");
        }
        ResolvedQuestion resolution = questions.resolve(
                sessionId,
                questionId,
                user.id(),
                request.status(),
                request.answerText(),
                request.answerVisibility());
        publisher.publish("qa.question_updated", session);
        if (resolution.changed() && resolution.studentAnswer() != null) {
            applicationEvents.publishEvent(new StudentQuestionAnswerPublished(
                    session.joinCode(), resolution.authorPersonId(), resolution.studentAnswer()));
        }
        return resolution.question();
    }

    public UUID participantPersonId(String joinCode, String participantToken) {
        return participantSession(joinCode, participantToken, null).participant().personId();
    }

    @Transactional
    public StudentSessionSnapshot submitName(
            String joinCode, StudentNameRequest request, AuthenticatedUser user) {
        ParticipantSession current = participantSession(joinCode, request.participantToken(), user);
        String lastName = request.lastName().trim().replaceAll("\\s+", " ");
        String firstName = request.firstName().trim().replaceAll("\\s+", " ");
        if (lastName.length() < 2 || firstName.length() < 2) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter first and last name");
        }
        String name = lastName + " " + firstName;
        sessions.submitParticipantName(current.session().id(), current.participant().personId(), name)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "Student is not connected"));
        persons.updateStudentDisplayName(current.participant().personId(), name);
        publisher.publish("participant.name_submitted", current.session());
        return snapshots.create(current.session(), current.participant().personId(), true);
    }

    @Transactional
    public void sendCurrentSlideToChat(String joinCode, String participantToken, AuthenticatedUser user) {
        ParticipantSession current = participantSession(joinCode, participantToken, user);
        if (current.session().status() != SessionStatus.LIVE
                && current.session().status() != SessionStatus.PAUSED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Session is not running");
        }
        channelFanout.sendSlideToStudent(
                current.session().id(), current.participant().personId(),
                current.session().currentSlideIdx(),
                studentDecks.slideImageUrlForDelivery(
                        current.session().courseId(), current.session().deckId(),
                        current.session().currentSlideIdx()));
    }

    private void requireActive(UUID sessionId, UUID personId) {
        if (sessions.participationState(sessionId, personId).filter(LiveSessionRepository.ParticipationState::active)
                .isEmpty()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Вас удалили из этой лекции");
        }
    }

    private ParticipantSession participantSession(String joinCode, String participantToken, AuthenticatedUser user) {
        LiveSession session = sessionByCode(joinCode);
        if (participantToken == null || participantToken.isBlank()) {
            if (user == null) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Participant token or login is required");
            }
            registerPerson(session, user, null);
            WebParticipant participant =
                    new WebParticipant(null, session.id(), user.id(), user.displayName(), IdentityLevel.PROFILE);
            return new ParticipantSession(session, participant);
        }
        WebParticipant participant = sessions.findWebParticipant(StudentTokenHasher.sha256(participantToken))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid participant token"));
        if (!participant.sessionId().equals(session.id())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Participant token does not belong to session");
        }
        requireActive(session.id(), participant.personId());
        return new ParticipantSession(session, participant);
    }

    private void touch(WebParticipant participant) {
        if (participant.id() != null) {
            sessions.touchWebParticipant(participant.id());
        }
    }

    @Transactional
    public ActivityResponse activityRespond(
            String joinCode, UUID runId, SubmitActivityResponseRequest request, AuthenticatedUser user) {
        ParticipantSession current = participantSession(joinCode, request.participantToken(), user);
        ensureInteractive(current.session());
        ActivityResponse response = activityRespond.submitResponse(
                current.session().id(),
                runId,
                current.participant().personId(),
                request.questionId(),
                request.answer());
        touch(current.participant());
        return response;
    }

    @Transactional
    public PollVote pollRespond(
            String joinCode, UUID pollId, String participantToken, int optionIdx, AuthenticatedUser user) {
        ParticipantSession current = participantSession(joinCode, participantToken, user);
        ensureInteractive(current.session());
        PollVote vote = quickPolls.respond(current.session().id(), pollId, current.participant().personId(), optionIdx);
        touch(current.participant());
        if (vote.accepted()) {
            publisher.publish("interaction.poll_answered", current.session());
        }
        return vote;
    }

    private StudyGroup selectSessionGroup(LiveSession session, UUID requestedGroupId) {
        List<StudyGroup> groups = studyGroups(session);
        if (requestedGroupId != null) {
            return groups.stream()
                    .filter(group -> group.id().equals(requestedGroupId))
                    .findFirst()
                    .orElseThrow(() -> new GroupSelectionRequiredException(groups));
        }
        if (groups.size() == 1) {
            return groups.get(0);
        }
        throw new GroupSelectionRequiredException(groups);
    }

    private List<StudyGroup> studyGroups(LiveSession session) {
        return session.groups().stream()
                .map(group -> new StudyGroup(group.id(), session.courseId(), group.name()))
                .toList();
    }

    private LiveSession sessionByCode(String joinCode) {
        return sessions.findByJoinCode(joinCode.trim().toUpperCase())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found"));
    }

    private void ensureJoinable(LiveSession session) {
        if (List.of(SessionStatus.ENDED, SessionStatus.ARCHIVED).contains(session.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Session is already ended");
        }
    }

    private void ensureInteractive(LiveSession session) {
        if (session.status() != SessionStatus.LIVE) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Session interactions are paused");
        }
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private record ParticipantSession(LiveSession session, WebParticipant participant) {}
}
