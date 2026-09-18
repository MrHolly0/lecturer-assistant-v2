package ru.university.assistant.live.internal;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.content.api.Slide;
import ru.university.assistant.content.api.SlideDeckDetails;
import ru.university.assistant.content.api.StudentDeckApi;
import ru.university.assistant.feedback.api.FeedbackApi;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.EphemeralPersonApi;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.UserProfile;
import ru.university.assistant.live.api.IdentityLevel;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StudentEngagement;
import ru.university.assistant.live.api.StudentJoinRequest;
import ru.university.assistant.live.api.StudentJoinResponse;
import ru.university.assistant.live.api.StudentQuestionRequest;
import ru.university.assistant.live.api.StudentSessionSnapshot;
import ru.university.assistant.live.api.StudentSignalRequest;
import ru.university.assistant.live.api.StudentSlide;
import ru.university.assistant.org.api.CourseMembershipApi;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.interaction.api.ActivePollView;
import ru.university.assistant.interaction.api.ActivityRespondApi;
import ru.university.assistant.interaction.api.ActivityResponse;
import ru.university.assistant.interaction.api.QuickPollApi;
import ru.university.assistant.interaction.api.SubmitActivityResponseRequest;
import ru.university.assistant.qa.api.QuestionApi;
import ru.university.assistant.qa.api.StudentQuestion;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class StudentWebSessionService {
    private static final SecureRandom RANDOM = new SecureRandom();

    private final LiveSessionRepository sessions;
    private final StudentDeckApi decks;
    private final FeedbackApi feedback;
    private final QuestionApi questions;
    private final EphemeralPersonApi persons;
    private final CourseMembershipApi memberships;
    private final CourseAccessApi courseAccess;
    private final EventBus events;
    private final LiveSessionPublisher publisher;
    private final QuickPollApi quickPolls;
    private final ActivityRespondApi activityRespond;

    StudentWebSessionService(
            LiveSessionRepository sessions,
            StudentDeckApi decks,
            FeedbackApi feedback,
            QuestionApi questions,
            EphemeralPersonApi persons,
            CourseMembershipApi memberships,
            CourseAccessApi courseAccess,
            EventBus events,
            LiveSessionPublisher publisher,
            QuickPollApi quickPolls,
            ActivityRespondApi activityRespond) {
        this.sessions = sessions;
        this.decks = decks;
        this.feedback = feedback;
        this.questions = questions;
        this.persons = persons;
        this.memberships = memberships;
        this.courseAccess = courseAccess;
        this.events = events;
        this.publisher = publisher;
        this.quickPolls = quickPolls;
        this.activityRespond = activityRespond;
    }

    public StudentSessionSnapshot snapshot(String joinCode) {
        LiveSession session = sessionByCode(joinCode);
        return snapshot(session);
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
                sessions.touchWebParticipant(existing.id());
                return new StudentJoinResponse(presented, existing.id(), existing.identityLevel(), snapshot(session));
            }
        }
        if (user != null) {
            registerPerson(session, user);
            sessions.deleteProfileTokens(session.id(), user.id());
            String token = randomToken();
            WebParticipant participant = sessions.createWebToken(
                    UuidV7.generate(), session.id(), user.id(),
                    StudentTokenHasher.sha256(token), user.displayName(), IdentityLevel.PROFILE);
            return new StudentJoinResponse(token, participant.id(), IdentityLevel.PROFILE, snapshot(session));
        }
        UserProfile person = persons.createEphemeralStudent(request == null ? null : request.displayName());
        // Гость живёт только в сессии: в постоянный состав курса он не попадает (D-14).
        publishJoined(
                session,
                person.id(),
                sessions.joinPerson(session.id(), person.id(), person.displayName()),
                IdentityLevel.EPHEMERAL);
        String token = randomToken();
        WebParticipant participant = sessions.createWebToken(
                UuidV7.generate(), session.id(), person.id(),
                StudentTokenHasher.sha256(token), person.displayName(), IdentityLevel.EPHEMERAL);
        return new StudentJoinResponse(token, participant.id(), participant.identityLevel(), snapshot(session));
    }

    /** Реальный человек (вход через MAX или по паролю): один участник сессии, студент курса добавляется один раз. */
    private void registerPerson(LiveSession session, AuthenticatedUser user) {
        if (user.role() == PersonRole.STUDENT) {
            memberships.ensureStudentMember(session.courseId(), user.id());
        }
        LiveSessionRepository.JoinOutcome outcome = sessions.joinPerson(session.id(), user.id(), user.displayName());
        if (outcome.kicked()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Вас удалили из этой лекции");
        }
        publishJoined(session, user.id(), outcome, IdentityLevel.PROFILE);
    }

    private void publishJoined(
            LiveSession session, UUID personId, LiveSessionRepository.JoinOutcome outcome, IdentityLevel level) {
        if (!outcome.inserted()) {
            return;
        }
        events.publish(new DomainEvent(
                "live.session",
                session.id(),
                "participant.joined",
                personId,
                Map.of("courseId", session.courseId(), "sessionId", session.id(), "lectureId", session.lectureId()),
                Map.of("channelType", "web", "identityLevel", level.name())));
        publisher.publish("participant.joined", session);
    }

    @Transactional
    public SignalAggregate signal(String joinCode, StudentSignalRequest request, AuthenticatedUser user) {
        ParticipantSession current = participantSession(joinCode, request.participantToken(), user);
        ensureJoinable(current.session());
        SignalAggregate aggregate = feedback.saveSignal(
                current.session().id(), current.participant().personId(), "web", request.value());
        touch(current.participant());
        publisher.publish("feedback.signal_submitted", current.session());
        return aggregate;
    }

    @Transactional
    public StudentQuestion ask(String joinCode, StudentQuestionRequest request, AuthenticatedUser user) {
        ParticipantSession current = participantSession(joinCode, request.participantToken(), user);
        ensureJoinable(current.session());
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
        sessions.findByCourse(courseId, sessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found"));
        return new StudentEngagement(feedback.aggregate(sessionId), questions.openQuestions(sessionId));
    }

    public boolean tokenBelongsToJoinCode(String joinCode, String participantToken) {
        participantSession(joinCode, participantToken, null);
        return true;
    }

    private ParticipantSession participantSession(String joinCode, String participantToken, AuthenticatedUser user) {
        LiveSession session = sessionByCode(joinCode);
        if (participantToken == null || participantToken.isBlank()) {
            if (user == null) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Participant token or login is required");
            }
            registerPerson(session, user);
            WebParticipant participant =
                    new WebParticipant(null, session.id(), user.id(), user.displayName(), IdentityLevel.PROFILE);
            return new ParticipantSession(session, participant);
        }
        WebParticipant participant = sessions.findWebParticipant(StudentTokenHasher.sha256(participantToken))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid participant token"));
        if (!participant.sessionId().equals(session.id())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Participant token does not belong to session");
        }
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
        ensureJoinable(current.session());
        ActivityResponse response = activityRespond.submitResponse(
                runId, current.participant().personId(), request.questionId(), request.answer());
        touch(current.participant());
        return response;
    }

    @Transactional
    public void pollRespond(
            String joinCode, UUID pollId, String participantToken, int optionIdx, AuthenticatedUser user) {
        ParticipantSession current = participantSession(joinCode, participantToken, user);
        ensureJoinable(current.session());
        quickPolls.respond(pollId, current.participant().personId(), optionIdx);
        touch(current.participant());
        publisher.publish("poll.response.recorded", current.session());
    }

    private StudentSessionSnapshot snapshot(LiveSession session) {
        SlideDeckDetails deck = decks.getDeckForStudent(session.courseId(), session.deckId());
        Slide slide = deck.slides().stream()
                .filter(item -> item.idx() == session.currentSlideIdx())
                .findFirst()
                .orElseGet(() -> deck.slides().isEmpty() ? null : deck.slides().get(0));
        if (slide == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Session deck has no slides");
        }
        ActivePollView activePoll = quickPolls.activePollForSession(session.id()).orElse(null);
        return new StudentSessionSnapshot(
                session.id(),
                session.courseId(),
                session.lectureTitle(),
                session.status(),
                session.joinCode(),
                session.currentSlideIdx(),
                deck.slideCount(),
                new StudentSlide(slide.idx(), slide.imageUrl(), slide.textExtract()),
                session.annotations(),
                feedback.aggregate(session.id()),
                activePoll);
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

    private String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private record ParticipantSession(LiveSession session, WebParticipant participant) {}
}
