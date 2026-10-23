package ru.university.assistant.live.internal;

import java.util.List;
import java.util.LinkedHashMap;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import ru.university.assistant.content.api.Slide;
import ru.university.assistant.content.api.StudentSlideView;
import ru.university.assistant.content.api.StudentSlideReadApi;
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
    private final StudentSlideReadApi decks;
    private final JdbcClient jdbc;
    private final Counter cacheHits;
    private final Counter cacheMisses;
    private final Timer loadTimer;
    private final Map<UUID, CachedSnapshot> cache = new LinkedHashMap<>(16, 0.75f, true);
    private long cachedBytes;
    private final FeedbackApi feedback;
    private final QuestionApi questions;
    private final QuickPollApi quickPolls;

    StudentSessionSnapshotService(
            LiveSessionRepository sessions,
            StudentSlideReadApi decks,
            FeedbackApi feedback,
            QuestionApi questions,
            QuickPollApi quickPolls, JdbcClient jdbc, MeterRegistry meters) {
        this.sessions = sessions;
        this.decks = decks;
        this.feedback = feedback;
        this.questions = questions;
        this.quickPolls = quickPolls;
        this.jdbc = jdbc;
        cacheHits = meters.counter("live.student.snapshot_cache", "result", "hit");
        cacheMisses = meters.counter("live.student.snapshot_cache", "result", "miss");
        loadTimer = meters.timer("live.student.snapshot_load");
        meters.gauge("live.student.snapshot_cache.bytes", this, value -> value.cachedBytes());
    }

    StudentSessionSnapshot create(LiveSession session, UUID viewerPersonId, boolean includeMyVote) {
        SnapshotData data = load(session);
        LiveSessionRepository.ParticipationState state = viewerPersonId == null ? null
                : sessions.participationState(session.id(), viewerPersonId).orElse(null);
        return personalize(data, viewerPersonId, includeMyVote, state,
                viewerPersonId == null ? List.of()
                        : questions.personalQuestions(session.id(), Set.of(viewerPersonId))
                                .getOrDefault(viewerPersonId, List.of()));
    }

    Map<UUID, StudentSessionSnapshot> createForViewers(LiveSession session, Set<UUID> viewerPersonIds) {
        SnapshotData data = load(session);
        Map<UUID, LiveSessionRepository.ParticipationState> states =
                sessions.participationStates(session.id(), viewerPersonIds);
        var personal = questions.personalQuestions(session.id(), viewerPersonIds);
        return viewerPersonIds.stream().collect(Collectors.toMap(
                Function.identity(), viewer -> personalize(data, viewer, false, states.get(viewer),
                        personal.getOrDefault(viewer, List.of()))));
    }

    private SnapshotData load(LiveSession session) {
        StudentSlideView deck = decks.slide(session.courseId(), session.deckId(), session.currentSlideIdx());
        Slide slide = deck.slide();
        String courseTitle = sessions.courseTitle(session.courseId());
        long revision = jdbc.sql("""
                select coalesce(sum(revision), 0)::bigint from live.student_snapshot_revisions
                where session_id = :session
                """).param("session", session.id()).query(Long.class).single();
        SharedKey key = new SharedKey(revision, session.version(), courseTitle, session.lectureTitle(),
                session.groups(), session.status(), session.currentSlideIdx(), session.annotations(),
                session.showJoinCode(), deck);
        boolean cacheable = !TransactionSynchronizationManager.isActualTransactionActive();
        SnapshotData cached = cacheable ? cached(session.id(), key) : null;
        if (cached != null) { cacheHits.increment(); return cached; }
        cacheMisses.increment();
        return loadTimer.record(() -> build(session, deck, slide, courseTitle, key, cacheable));
    }

    private SnapshotData build(LiveSession session, StudentSlideView deck, Slide slide,
            String courseTitle, SharedKey key, boolean cacheable) {
        ActivePollView activePoll = quickPolls.activePollForSession(session.id()).orElse(null);
        List<QuestionAnswerAudience> answers = questions.answeredQuestions(session.id());
        StudentSessionSnapshot shared = new StudentSessionSnapshot(
                session.id(),
                session.courseId(),
                courseTitle,
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
                visibleAnswers(answers, null),
                false,
                false, session.version(), session.showJoinCode(), List.of());
        SnapshotData result = new SnapshotData(shared, answers);
        if (cacheable) remember(session.id(), key, result);
        return result;
    }

    private StudentSessionSnapshot personalize(
            SnapshotData data, UUID viewerPersonId, boolean includeMyVote,
            LiveSessionRepository.ParticipationState state,
            List<ru.university.assistant.qa.api.StudentQuestion> personalQuestions) {
        StudentSessionSnapshot shared = data.shared();
        boolean kicked = state != null && state.kicked();
        Integer myVote = !kicked && includeMyVote && viewerPersonId != null && shared.activePoll() != null
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
                kicked ? null : shared.currentSlide(),
                shared.annotations(),
                shared.signalAggregate(),
                kicked ? null : shared.activePoll(),
                myVote,
                kicked ? List.of() : personalizedAnswers(data, viewerPersonId),
                kicked,
                state != null && state.active() && state.nameRequested(),
                shared.version(), shared.showJoinCode(), kicked ? List.of() : personalQuestions,
                !kicked && includeMyVote && viewerPersonId != null && shared.activePoll() != null
                        ? quickPolls.myTextAnswer(shared.activePoll().pollId(), viewerPersonId) : null);
    }

    private List<StudentQuestionAnswer> personalizedAnswers(SnapshotData data, UUID viewerPersonId) {
        // Most viewers only receive public answers. Reuse that immutable list instead of copying
        // the complete public answer history for every student on every SSE tick.
        boolean hasPrivateAnswer = viewerPersonId != null && data.answers().stream()
                .anyMatch(answer -> answer.answer().answerVisibility() != QuestionAnswerVisibility.SESSION
                        && viewerPersonId.equals(answer.authorPersonId()));
        return hasPrivateAnswer ? visibleAnswers(data.answers(), viewerPersonId) : data.shared().questionAnswers();
    }

    private List<StudentQuestionAnswer> visibleAnswers(
            List<QuestionAnswerAudience> answers, UUID viewerPersonId) {
        return answers.stream()
                .filter(answer -> answer.answer().answerVisibility() == QuestionAnswerVisibility.SESSION
                        || viewerPersonId != null && viewerPersonId.equals(answer.authorPersonId()))
                .map(QuestionAnswerAudience::answer)
                .toList();
    }

    private synchronized SnapshotData cached(UUID id, SharedKey key) {
        CachedSnapshot entry = cache.get(id);
        return entry != null && entry.key().equals(key) ? entry.data() : null;
    }

    private synchronized long cachedBytes() { return cachedBytes; }

    private synchronized void remember(UUID id, SharedKey key, SnapshotData data) {
        long bytes = 1024 + 2L * (data.shared().annotations().toString().length()
                + key.toString().length());
        for (QuestionAnswerAudience answer : data.answers()) {
            bytes += 256 + 2L * answer.answer().toString().length();
        }
        if (bytes > 32 * 1024 * 1024L) return;
        CachedSnapshot previous = cache.put(id, new CachedSnapshot(key, data, bytes));
        cachedBytes += bytes - (previous == null ? 0 : previous.bytes());
        while (cache.size() > 512 || cachedBytes > 32 * 1024 * 1024L) {
            var iterator = cache.entrySet().iterator();
            cachedBytes -= iterator.next().getValue().bytes(); iterator.remove();
        }
    }

    private record SharedKey(long revision, long version, String courseTitle, String lectureTitle,
            List<ru.university.assistant.live.api.SessionGroup> groups,
            ru.university.assistant.live.api.SessionStatus status, int slideIndex,
            Map<String, Object> annotations, boolean showJoinCode, StudentSlideView slide) {}
    private record CachedSnapshot(SharedKey key, SnapshotData data, long bytes) {}

    private record SnapshotData(
            StudentSessionSnapshot shared,
            List<QuestionAnswerAudience> answers) {}
}
