package ru.university.assistant.interaction.internal;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.interaction.api.ActivePollView;
import ru.university.assistant.interaction.api.ClosePollRequest;
import ru.university.assistant.interaction.api.PollResult;
import ru.university.assistant.interaction.api.PollStatus;
import ru.university.assistant.interaction.api.PollVote;
import ru.university.assistant.interaction.api.QuickPoll;
import ru.university.assistant.interaction.api.QuickPollApi;
import ru.university.assistant.interaction.api.StartPollRequest;
import ru.university.assistant.live.api.LiveSessionAccessApi;
import ru.university.assistant.shared.api.UuidV7;

@Service
public class PollService implements QuickPollApi {
    private final PollRepository polls;
    private final LiveSessionAccessApi liveSessions;

    PollService(PollRepository polls, LiveSessionAccessApi liveSessions) {
        this.polls = polls;
        this.liveSessions = liveSessions;
    }

    // Преподавательские методы ниже принимают courseId и в первую очередь проверяют, что
    // sessionId принадлежит этому курсу (D-10) — тем же приёмом, что и live/content.

    @Transactional
    public PollResult start(UUID courseId, UUID sessionId, UUID createdBy, StartPollRequest request) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        polls.findOpenForSession(sessionId).ifPresent(existing -> {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A poll is already open for this session");
        });
        QuickPoll poll = polls.create(UuidV7.generate(), sessionId, createdBy,
                request.questionText(), request.options());
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
    public PollResult close(UUID courseId, UUID sessionId, UUID pollId, ClosePollRequest request) {
        liveSessions.requireSessionInCourse(courseId, sessionId);
        QuickPoll poll = pollInSession(sessionId, pollId);
        if (poll.status() == PollStatus.CLOSED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Poll already closed");
        }
        QuickPoll closed = polls.close(pollId, request.correctOptionIdx());
        return result(closed);
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
}
