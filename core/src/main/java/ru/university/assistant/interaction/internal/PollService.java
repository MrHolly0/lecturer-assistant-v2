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
import ru.university.assistant.shared.api.UuidV7;

@Service
public class PollService implements QuickPollApi {
    private final PollRepository polls;

    PollService(PollRepository polls) {
        this.polls = polls;
    }

    @Transactional
    public PollResult start(UUID sessionId, UUID createdBy, StartPollRequest request) {
        polls.findOpenForSession(sessionId).ifPresent(existing -> {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A poll is already open for this session");
        });
        QuickPoll poll = polls.create(UuidV7.generate(), sessionId, createdBy,
                request.questionText(), request.options());
        return result(poll);
    }

    public PollResult getActive(UUID sessionId) {
        QuickPoll poll = polls.findLatestForSession(sessionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No active poll"));
        return result(poll);
    }

    public PollResult getResult(UUID pollId) {
        QuickPoll poll = polls.findById(pollId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Poll not found"));
        return result(poll);
    }

    @Transactional
    public PollResult close(UUID pollId, ClosePollRequest request) {
        QuickPoll poll = polls.findById(pollId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Poll not found"));
        if (poll.status() == PollStatus.CLOSED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Poll already closed");
        }
        QuickPoll closed = polls.close(pollId, request.correctOptionIdx());
        return result(closed);
    }

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
