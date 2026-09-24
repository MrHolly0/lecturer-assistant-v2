package ru.university.assistant.live.internal;

import java.util.List;
import java.util.Map;
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
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.shared.api.CodeGenerator;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class LiveSessionService implements LiveSessionAccessApi {
    private final CourseAccessApi courseAccess;
    private final LiveSessionRepository sessions;
    private final EventBus events;
    private final LiveSessionPublisher publisher;
    private final ChannelFanoutApi channelFanout;

    LiveSessionService(
            CourseAccessApi courseAccess,
            LiveSessionRepository sessions,
            EventBus events,
            LiveSessionPublisher publisher,
            ChannelFanoutApi channelFanout) {
        this.courseAccess = courseAccess;
        this.sessions = sessions;
        this.events = events;
        this.publisher = publisher;
        this.channelFanout = channelFanout;
    }

    @Transactional
    public LiveSession start(AuthenticatedUser user, UUID courseId, UUID lectureId) {
        courseAccess.requireManage(user, courseId);
        if (!sessions.lectureBelongsToCourse(courseId, lectureId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lecture not found");
        }
        LiveSession session = sessions.create(UuidV7.generate(), lectureId, user.id(), CodeGenerator.readableCode(6));
        sessions.addSlideLog(session.id(), session.currentSlideIdx());
        event(user, session, "session.started", Map.of("joinCode", session.joinCode()));
        publisher.publish("session.started", session);
        return session;
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
        ensureActive(before);
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
        ensureActive(current);
        LiveSession after = sessions.updateAnnotations(courseId, sessionId, request.annotations());
        event(user, after, "slide.annotations_updated", Map.of("slideIdx", after.currentSlideIdx()));
        publisher.publish("slide.annotations_updated", after);
        return after;
    }

    @Transactional
    public LiveSession transition(AuthenticatedUser user, UUID courseId, UUID sessionId, SessionStatus target) {
        courseAccess.requireManage(user, courseId);
        LiveSession current = session(courseId, sessionId);
        if (current.status() == SessionStatus.ENDED && target != SessionStatus.ARCHIVED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Ended session cannot be resumed");
        }
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
    public LiveSession requireSessionInCourse(UUID courseId, UUID sessionId) {
        return session(courseId, sessionId);
    }

    private void ensureActive(LiveSession session) {
        if (session.status() != SessionStatus.LIVE && session.status() != SessionStatus.PAUSED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Session is not active");
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
