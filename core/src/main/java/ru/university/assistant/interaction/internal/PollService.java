package ru.university.assistant.interaction.internal;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.interaction.api.ActivePollView;
import ru.university.assistant.interaction.api.ClosePollRequest;
import ru.university.assistant.interaction.api.ClosedPollPage;
import ru.university.assistant.interaction.api.PollResult;
import ru.university.assistant.interaction.api.PollStatus;
import ru.university.assistant.interaction.api.PollVote;
import ru.university.assistant.interaction.api.QuestionBankEntry;
import ru.university.assistant.interaction.api.QuestionOption;
import ru.university.assistant.interaction.api.QuestionType;
import ru.university.assistant.interaction.api.QuickPoll;
import ru.university.assistant.interaction.api.QuickPollApi;
import ru.university.assistant.interaction.api.StartPollRequest;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.SessionStatus;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class PollService implements QuickPollApi {
    private static final int MAX_PAGE_SIZE = 100;

    private final PollRepository polls;
    private final LiveSessionAccessApi liveSessions;
    private final QuestionBankService questionBank;
    private final EventBus events;

    PollService(
            PollRepository polls,
            LiveSessionAccessApi liveSessions,
            QuestionBankService questionBank,
            EventBus events) {
        this.polls = polls;
        this.liveSessions = liveSessions;
        this.questionBank = questionBank;
        this.events = events;
    }

    // Преподавательские методы ниже принимают courseId и в первую очередь проверяют, что
    // sessionId принадлежит этому курсу (D-10) — тем же приёмом, что и live/content.

    @Transactional
    public PollResult start(UUID courseId, UUID sessionId, UUID createdBy, StartPollRequest request) {
        LiveSession session = prepareStart(courseId, sessionId);
        QuickPoll poll = polls.create(
                UuidV7.generate(), sessionId, createdBy, null, request.questionText(), request.options(), null);
        publishStarted(courseId, session, poll, createdBy);
        return result(poll);
    }

    @Transactional
    public PollResult startFromBank(UUID courseId, UUID sessionId, UUID createdBy, UUID questionId) {
        LiveSession session = prepareStart(courseId, sessionId);
        QuestionBankEntry question = questionBank.get(courseId, questionId);
        validateBankQuestion(question);
        List<String> options = question.options().stream().map(QuestionOption::text).toList();
        int correctOptionIdx = correctOptionIdx(question.options());
        QuickPoll poll = polls.create(
                UuidV7.generate(), sessionId, createdBy, question.id(), question.text(), options, correctOptionIdx);
        publishStarted(courseId, session, poll, createdBy);
        return result(poll);
    }

    public PollResult getActive(UUID courseId, UUID sessionId) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        QuickPoll poll = polls.findLatestForSession(sessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No active poll"));
        return result(poll);
    }

    public PollResult getResult(UUID courseId, UUID sessionId, UUID pollId) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        return result(pollInSession(sessionId, pollId));
    }

    @Transactional
    public PollResult setCorrectOption(UUID courseId, UUID sessionId, UUID pollId, Integer correctOptionIdx) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        QuickPoll poll = pollInSession(sessionId, pollId);
        if (poll.status() != PollStatus.OPEN) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Poll already closed");
        }
        if (correctOptionIdx != null && (correctOptionIdx < 0 || correctOptionIdx >= poll.options().size())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid correct option index");
        }
        QuickPoll updated = polls.setCorrectOption(pollId, correctOptionIdx)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "Poll already closed"));
        return result(updated);
    }

    @Transactional(readOnly = true)
    public ClosedPollPage listClosed(UUID courseId, UUID sessionId, int limit, int offset) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        if (limit < 1 || limit > MAX_PAGE_SIZE || offset < 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "limit must be between 1 and 100 and offset must be non-negative");
        }
        List<PollResult> items = polls.findClosedForSession(sessionId, limit, offset).stream()
                .map(this::result)
                .toList();
        return new ClosedPollPage(items, limit, offset, polls.countClosedForSession(sessionId));
    }

    @Transactional
    public PollResult close(
            UUID courseId, UUID sessionId, UUID pollId, UUID closedBy, ClosePollRequest request) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        QuickPoll poll = pollInSession(sessionId, pollId);
        if (poll.status() == PollStatus.CLOSED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Poll already closed");
        }
        Integer requestedCorrect = request.correctOptionIdx();
        if (requestedCorrect != null && (requestedCorrect < 0 || requestedCorrect >= poll.options().size())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid correct option index");
        }
        QuickPoll closed = polls.close(pollId, request.correctOptionIdx());
        PollResult result = result(closed);
        events.publish(new DomainEvent(
                "interaction.poll",
                closed.id(),
                "interaction.poll_closed",
                closedBy,
                Map.of("courseId", courseId, "sessionId", sessionId, "pollId", closed.id()),
                payload(
                        "correctOptionIdx", closed.correctOptionIdx(),
                        "totalResponses", result.totalResponses())));
        return result;
    }

    private QuickPoll pollInSession(UUID sessionId, UUID pollId) {
        return polls.findById(pollId)
                .filter(found -> found.sessionId().equals(sessionId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Poll not found"));
    }

    // Студенческий путь (QuickPollApi) — sessionId уже доверенный (взят сервером из joinCode/JWT,
    // не из тела запроса), courseId здесь не нужен; принадлежность pollId сессии — D-09, из B-05.

    @Transactional
    @Override
    public PollVote respond(UUID sessionId, UUID pollId, UUID personId, int optionIdx) {
        requireLive(liveSessions.requireSession(sessionId));
        QuickPoll poll = polls.findById(pollId)
                .filter(found -> found.sessionId().equals(sessionId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Poll not found"));
        if (poll.status() == PollStatus.CLOSED) {
            return new PollVote(false, polls.findVote(pollId, personId).orElse(null));
        }
        if (optionIdx < 0 || optionIdx >= poll.options().size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid option index");
        }
        boolean accepted = polls.respond(UuidV7.generate(), pollId, personId, optionIdx);
        if (accepted) {
            Map<String, Object> answer = payload("optionIdx", optionIdx);
            if (poll.correctOptionIdx() != null) {
                answer.put("correct", optionIdx == poll.correctOptionIdx());
            }
            events.publish(new DomainEvent(
                    "interaction.poll",
                    poll.id(),
                    "interaction.poll_answered",
                    personId,
                    Map.of("sessionId", sessionId, "pollId", poll.id()),
                    answer));
        }
        return new PollVote(accepted, polls.findVote(pollId, personId).orElse(null));
    }

    @Override
    public Integer myVote(UUID pollId, UUID personId) {
        return polls.findVote(pollId, personId).orElse(null);
    }

    @Override
    public Optional<ActivePollView> activePollForSession(UUID sessionId) {
        return polls.findLatestForSession(sessionId).map(this::toView);
    }

    private PollResult result(QuickPoll poll) {
        List<Integer> votes = polls.voteCounts(poll.id(), poll.options().size());
        int total = votes.stream().mapToInt(Integer::intValue).sum();
        return new PollResult(poll, votes, total);
    }

    private ActivePollView toView(QuickPoll poll) {
        boolean closed = poll.status() == PollStatus.CLOSED;
        // До закрытия студент не видит ни правильного ответа, ни распределения (D-08).
        Integer correct = closed ? poll.correctOptionIdx() : null;
        List<Integer> votes = closed ? polls.voteCounts(poll.id(), poll.options().size()) : null;
        return new ActivePollView(poll.id(), poll.questionText(), poll.options(), poll.status(), correct, votes);
    }

    private LiveSession prepareStart(UUID courseId, UUID sessionId) {
        LiveSession session = liveSessions.requireSessionInCourse(courseId, sessionId);
        requireLive(session);
        polls.findOpenForSession(sessionId).ifPresent(existing -> {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A poll is already open for this session");
        });
        return session;
    }

    private void requireLive(LiveSession session) {
        if (session.status() != SessionStatus.LIVE) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Session interactions are paused");
        }
    }

    private void validateBankQuestion(QuestionBankEntry question) {
        if (question.questionType() != QuestionType.CHOICE && question.questionType() != QuestionType.TRUE_FALSE) {
            throw new ResponseStatusException(
                    HttpStatus.UNPROCESSABLE_ENTITY, "Question type cannot be used as a poll");
        }
        if (question.options().size() < 2 || question.options().size() > 6
                || question.options().stream().filter(QuestionOption::correct).count() != 1) {
            throw new ResponseStatusException(
                    HttpStatus.UNPROCESSABLE_ENTITY, "Poll question must have 2-6 options and one correct answer");
        }
    }

    private int correctOptionIdx(List<QuestionOption> options) {
        for (int i = 0; i < options.size(); i++) {
            if (options.get(i).correct()) {
                return i;
            }
        }
        throw new IllegalStateException("Validated question has no correct option");
    }

    private void publishStarted(UUID courseId, LiveSession session, QuickPoll poll, UUID createdBy) {
        events.publish(new DomainEvent(
                "interaction.poll",
                poll.id(),
                "interaction.poll_started",
                createdBy,
                Map.of("courseId", courseId, "sessionId", session.id(), "pollId", poll.id()),
                payload(
                        "slideIdx", session.currentSlideIdx(),
                        "optionCount", poll.options().size(),
                        "sourceQuestionId", poll.sourceQuestionId(),
                        "correctOptionIdx", poll.correctOptionIdx())));
    }

    private static Map<String, Object> payload(Object... pairs) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            if (pairs[i + 1] != null) {
                result.put((String) pairs[i], pairs[i + 1]);
            }
        }
        return result;
    }
}
