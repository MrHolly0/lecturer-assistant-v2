package ru.university.assistant.live.internal;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.content.api.Slide;
import ru.university.assistant.content.api.SlideDeckDetails;
import ru.university.assistant.content.api.StudentDeckApi;
import ru.university.assistant.feedback.api.FeedbackApi;
import ru.university.assistant.interaction.api.ActivePollView;
import ru.university.assistant.interaction.api.QuickPollApi;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.StudentSessionSnapshot;
import ru.university.assistant.live.api.StudentSlide;
import ru.university.assistant.qa.api.QuestionAnswerAudience;
import ru.university.assistant.qa.api.QuestionAnswerVisibility;
import ru.university.assistant.qa.api.QuestionApi;
import ru.university.assistant.qa.api.StudentQuestionAnswer;

@Service
class StudentSessionSnapshotService {
    private final LiveSessionRepository sessions;
    private final StudentDeckApi decks;
    private final FeedbackApi feedback;
    private final QuestionApi questions;
    private final QuickPollApi quickPolls;

    StudentSessionSnapshotService(
            LiveSessionRepository sessions,
            StudentDeckApi decks,
            FeedbackApi feedback,
            QuestionApi questions,
            QuickPollApi quickPolls) {
        this.sessions = sessions;
        this.decks = decks;
        this.feedback = feedback;
        this.questions = questions;
        this.quickPolls = quickPolls;
    }

    StudentSessionSnapshot create(LiveSession session, UUID viewerPersonId, boolean includeMyVote) {
        SnapshotData data = load(session);
        return personalize(data, viewerPersonId, includeMyVote);
    }

    Map<UUID, StudentSessionSnapshot> createForViewers(LiveSession session, Set<UUID> viewerPersonIds) {
        SnapshotData data = load(session);
        return viewerPersonIds.stream().collect(Collectors.toMap(
                Function.identity(), viewer -> personalize(data, viewer, false)));
    }

    private SnapshotData load(LiveSession session) {
        SlideDeckDetails deck = decks.getDeckForStudent(session.courseId(), session.deckId());
        Slide slide = deck.slides().stream()
                .filter(item -> item.idx() == session.currentSlideIdx())
                .findFirst()
                .orElseGet(() -> deck.slides().isEmpty() ? null : deck.slides().get(0));
        if (slide == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Session deck has no slides");
        }
        ActivePollView activePoll = quickPolls.activePollForSession(session.id()).orElse(null);
        List<QuestionAnswerAudience> answers = questions.answeredQuestions(session.id());
        StudentSessionSnapshot shared = new StudentSessionSnapshot(
                session.id(),
                session.courseId(),
                sessions.courseTitle(session.courseId()),
                session.lectureTitle(),
                session.groups(),
                session.status(),
                session.joinCode(),
                session.currentSlideIdx(),
                deck.slideCount(),
                new StudentSlide(slide.idx(), slide.imageUrl(), slide.textExtract()),
                session.annotations(),
                feedback.aggregate(session.id(), session.currentSlideIdx()),
                activePoll,
                null,
                visibleAnswers(answers, null));
        return new SnapshotData(shared, answers);
    }

    private StudentSessionSnapshot personalize(
            SnapshotData data, UUID viewerPersonId, boolean includeMyVote) {
        StudentSessionSnapshot shared = data.shared();
        Integer myVote = includeMyVote && viewerPersonId != null && shared.activePoll() != null
                ? quickPolls.myVote(shared.activePoll().pollId(), viewerPersonId)
                : null;
        return new StudentSessionSnapshot(
                shared.sessionId(),
                shared.courseId(),
                shared.courseTitle(),
                shared.lectureTitle(),
                shared.groups(),
                shared.status(),
                shared.joinCode(),
                shared.currentSlideIdx(),
                shared.slideCount(),
                shared.currentSlide(),
                shared.annotations(),
                shared.signalAggregate(),
                shared.activePoll(),
                myVote,
                visibleAnswers(data.answers(), viewerPersonId));
    }

    private List<StudentQuestionAnswer> visibleAnswers(
            List<QuestionAnswerAudience> answers, UUID viewerPersonId) {
        return answers.stream()
                .filter(answer -> answer.answer().answerVisibility() == QuestionAnswerVisibility.SESSION
                        || viewerPersonId != null && viewerPersonId.equals(answer.authorPersonId()))
                .map(QuestionAnswerAudience::answer)
                .toList();
    }

    private record SnapshotData(
            StudentSessionSnapshot shared,
            List<QuestionAnswerAudience> answers) {}
}
