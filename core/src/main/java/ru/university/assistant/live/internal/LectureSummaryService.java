package ru.university.assistant.live.internal;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.LectureGroupSummary;
import ru.university.assistant.live.api.LectureSummary;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionParticipant;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.qa.api.StudentQuestion;

@Service
public class LectureSummaryService {
    private final CourseAccessApi courseAccess;
    private final LiveSessionRepository sessions;
    private final LectureSummaryRepository summaries;
    private final EventBus events;

    LectureSummaryService(
            CourseAccessApi courseAccess,
            LiveSessionRepository sessions,
            LectureSummaryRepository summaries,
            EventBus events) {
        this.courseAccess = courseAccess;
        this.sessions = sessions;
        this.summaries = summaries;
        this.events = events;
    }

    @Transactional
    public LectureSummary get(AuthenticatedUser user, UUID courseId, UUID sessionId) {
        courseAccess.requireManage(user, courseId);
        LiveSession session = sessions.findByCourse(courseId, sessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found"));
        if (session.status() != SessionStatus.ENDED && session.status() != SessionStatus.ARCHIVED) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "Lecture summary is available after the session ends");
        }
        if (session.startedAt() == null || session.endedAt() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Lecture session has no complete time range");
        }

        List<SessionParticipant> participants = sessions.listParticipants(sessionId);
        List<StudentQuestion> unanswered = summaries.unansweredQuestions(sessionId);
        long durationSeconds = Duration.between(session.startedAt(), session.endedAt()).getSeconds();
        long pausedDurationSeconds = summaries.pausedDurationSeconds(sessionId, session.endedAt());
        LectureSummary summary = new LectureSummary(
                session.id(),
                session.lectureId(),
                session.lectureTitle(),
                session.groups(),
                session.status(),
                session.startedAt(),
                session.endedAt(),
                durationSeconds,
                Math.max(0, durationSeconds - pausedDurationSeconds),
                pausedDurationSeconds,
                participants.size(),
                participants,
                summaries.signalTotals(sessionId),
                summaries.problemSlides(sessionId),
                summaries.pollResults(sessionId),
                summaries.questionCount(sessionId),
                unanswered.size(),
                unanswered,
                session.groups().stream()
                        .map(group -> new LectureGroupSummary(
                                group,
                                (int) participants.stream()
                                        .filter(participant -> group.id().equals(participant.groupId()))
                                        .count(),
                                summaries.signalTotals(sessionId, group.id()),
                                summaries.problemSlides(sessionId, group.id()),
                                summaries.pollResults(sessionId, group.id()),
                                summaries.questionCount(sessionId, group.id()),
                                summaries.unansweredQuestionCount(sessionId, group.id())))
                        .toList());
        events.publish(new DomainEvent(
                "live.session",
                session.id(),
                "summary.opened",
                user.id(),
                Map.of("courseId", courseId, "sessionId", session.id(), "lectureId", session.lectureId()),
                Map.of("role", user.role().name())));
        return summary;
    }
}
