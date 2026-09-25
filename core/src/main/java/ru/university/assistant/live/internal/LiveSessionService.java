package ru.university.assistant.live.internal;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.channel.api.ChannelFanoutApi;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.ChangeSlideRequest;
import ru.university.assistant.live.api.JoinSessionRequest;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.live.api.SaveAnnotationsRequest;
import ru.university.assistant.live.api.SessionParticipant;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.live.api.StartSessionGroup;
import ru.university.assistant.live.api.StartSessionRequest;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.org.api.CourseMembershipApi;
import ru.university.assistant.org.api.StudyGroup;
import ru.university.assistant.shared.api.CodeGenerator;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class LiveSessionService implements LiveSessionAccessApi {
    private final CourseAccessApi courseAccess;
    private final CourseMembershipApi memberships;
    private final LiveSessionRepository sessions;
    private final EventBus events;
    private final LiveSessionPublisher publisher;
    private final ChannelFanoutApi channelFanout;

    LiveSessionService(
            CourseAccessApi courseAccess,
            CourseMembershipApi memberships,
            LiveSessionRepository sessions,
            EventBus events,
            LiveSessionPublisher publisher,
            ChannelFanoutApi channelFanout) {
        this.courseAccess = courseAccess;
        this.memberships = memberships;
        this.sessions = sessions;
        this.events = events;
        this.publisher = publisher;
        this.channelFanout = channelFanout;
    }

    @Transactional
    public LiveSession start(
            AuthenticatedUser user, UUID courseId, UUID lectureId, StartSessionRequest request) {
        courseAccess.requireManage(user, courseId);
        List<StudyGroup> groups = resolveGroups(courseId, request);
        UUID deckId = sessions.lectureDeckId(courseId, lectureId).orElse(null);
        if (deckId == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lecture not found");
        }
        lockCurrentLectureDeck(courseId, lectureId, deckId);
        LiveSession session = sessions.create(
                UuidV7.generate(), lectureId, user.id(), CodeGenerator.readableCode(6), groups);
        sessions.addSlideLog(session.id(), session.currentSlideIdx());
        event(user, session, "session.started", Map.of(
                "joinCode", session.joinCode(),
                "groupIds", groups.stream().map(StudyGroup::id).toList()));
        publisher.publish("session.started", session);
        return session;
    }

    private List<StudyGroup> resolveGroups(UUID courseId, StartSessionRequest request) {
        if (request == null || request.groups() == null || request.groups().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "At least one study group is required");
        }
        LinkedHashMap<UUID, StudyGroup> unique = new LinkedHashMap<>();
        for (StartSessionGroup selection : request.groups()) {
            StudyGroup group = memberships.resolveSessionGroup(
                    courseId, selection.groupId(), selection.groupName());
            if (unique.putIfAbsent(group.id(), group) != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Study groups must be unique");
            }
        }
        return List.copyOf(unique.values());
    }

    private void lockCurrentLectureDeck(UUID courseId, UUID lectureId, UUID initialDeckId) {
        UUID deckId = initialDeckId;
        while (true) {
            sessions.lockDeckForSession(deckId);
            UUID observedDeckId = sessions.lectureDeckId(courseId, lectureId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Lecture not found"));
            if (!observedDeckId.equals(deckId)) {
                deckId = observedDeckId;
                continue;
            }
            UUID currentDeckId = sessions.lockLectureAndGetDeck(courseId, lectureId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Lecture not found"));
            if (currentDeckId.equals(deckId)) {
                return;
            }
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Lecture materials changed; retry session start");
        }
    }

    /** B-03: чтобы из мини-приложения преподаватель попадал сразу в свою идущую лекцию. */
    public Optional<LiveSession> activeSessionFor(AuthenticatedUser user) {
        return sessions.findActiveForCreator(user.id());
    }

    public LiveSession get(AuthenticatedUser user, UUID courseId, UUID sessionId) {
        courseAccess.requireVisible(user, courseId);
        return session(courseId, sessionId);
    }

    public List<SessionParticipant> participants(AuthenticatedUser user, UUID courseId, UUID sessionId) {
        courseAccess.requireManage(user, courseId);
        session(courseId, sessionId);
        return sessions.listParticipants(sessionId);
    }

    @Transactional
    public LiveSession join(AuthenticatedUser user, UUID courseId, JoinSessionRequest request) {
        courseAccess.requireVisible(user, courseId);
        LiveSession session = sessions.findByJoinCode(courseId, request.joinCode().trim().toUpperCase())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found"));
        sessions.join(session.id(), user);
        event(user, session, "participant.joined", Map.of("channelType", "web"));
        publisher.publish("participant.joined", session);
        return session;
    }

    @Transactional
    public LiveSession changeSlide(
            AuthenticatedUser user, UUID courseId, UUID sessionId, ChangeSlideRequest request) {
        courseAccess.requireManage(user, courseId);
        LiveSession before = session(courseId, sessionId);
        ensureLive(before);
        LiveSession after = sessions.updateSlide(courseId, sessionId, request.slideIdx());
        event(user, after, "session.slide_changed",
                Map.of("from", before.currentSlideIdx(), "to", after.currentSlideIdx()));
        channelFanout.sessionSlideChanged(after);
        publisher.publish("session.slide_changed", after);
        return after;
    }

    @Transactional
    public LiveSession saveAnnotations(
            AuthenticatedUser user, UUID courseId, UUID sessionId, SaveAnnotationsRequest request) {
        courseAccess.requireManage(user, courseId);
        LiveSession current = session(courseId, sessionId);
        ensureLive(current);
        LiveSession after = sessions.updateAnnotations(courseId, sessionId, request.annotations());
        event(user, after, "slide.annotations_updated", Map.of("slideIdx", after.currentSlideIdx()));
        publisher.publish("slide.annotations_updated", after);
        return after;
    }

    @Transactional
    public LiveSession transition(AuthenticatedUser user, UUID courseId, UUID sessionId, SessionStatus target) {
        courseAccess.requireManage(user, courseId);
        LiveSession current = session(courseId, sessionId);
        ensureTransition(current.status(), target);
        LiveSession after = sessions.updateStatus(courseId, sessionId, target);
        String verb = switch (target) {
            case PAUSED -> "session.paused";
            case LIVE -> "session.resumed";
            case ENDED -> "session.ended";
            case ARCHIVED -> "session.archived";
            case SCHEDULED -> "session.scheduled";
        };
        event(user, after, verb, Map.of("status", target.name()));
        publisher.publish(verb, after);
        return after;
    }

    private LiveSession session(UUID courseId, UUID sessionId) {
        return sessions.findByCourse(courseId, sessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found"));
    }

    @Override
    public LiveSession requireSession(UUID sessionId) {
        return sessions.findById(sessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found"));
    }

    @Override
    public LiveSession requireSessionInCourse(UUID courseId, UUID sessionId) {
        return session(courseId, sessionId);
    }

    private void ensureLive(LiveSession session) {
        if (session.status() != SessionStatus.LIVE) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Session is not live");
        }
    }

    private void ensureTransition(SessionStatus current, SessionStatus target) {
        boolean allowed = switch (current) {
            case SCHEDULED -> target == SessionStatus.LIVE;
            case LIVE -> target == SessionStatus.PAUSED || target == SessionStatus.ENDED;
            case PAUSED -> target == SessionStatus.LIVE || target == SessionStatus.ENDED;
            case ENDED -> target == SessionStatus.ARCHIVED;
            case ARCHIVED -> false;
        };
        if (!allowed) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "Cannot transition session from " + current + " to " + target);
        }
    }

    private void event(AuthenticatedUser user, LiveSession session, String verb, Map<String, Object> payload) {
        events.publish(new DomainEvent(
                "live.session",
                session.id(),
                verb,
                user.id(),
                Map.of("courseId", session.courseId(), "sessionId", session.id(), "lectureId", session.lectureId()),
                payload));
    }
}
