package ru.university.assistant.interaction.internal;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.interaction.api.PollStatus;
import ru.university.assistant.interaction.api.QuickPoll;
import ru.university.assistant.interaction.api.SessionPollLifecycleApi;

/** Closes session polls from Live without introducing a Live ↔ Interaction service cycle. */
@Service
class PollSessionLifecycleService implements SessionPollLifecycleApi {
    private final PollRepository polls;
    private final EventBus events;

    PollSessionLifecycleService(PollRepository polls, EventBus events) {
        this.polls = polls;
        this.events = events;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void closeOpenForSession(UUID courseId, UUID sessionId, UUID closedBy) {
        for (QuickPoll candidate : polls.findAllOpenForSession(sessionId)) {
            polls.lock(candidate.id());
            QuickPoll poll = polls.findById(candidate.id()).orElseThrow();
            if (poll.status() != PollStatus.OPEN) continue;

            QuickPoll closed = polls.close(poll.id(), poll.correctOptionIdx());
            int totalResponses = polls.voteCounts(closed.id(), closed.options().size()).stream()
                    .mapToInt(Integer::intValue)
                    .sum();
            Map<String, Object> payload = new LinkedHashMap<>();
            if (closed.correctOptionIdx() != null) {
                payload.put("correctOptionIdx", closed.correctOptionIdx());
            }
            payload.put("totalResponses", totalResponses);
            events.publish(new DomainEvent(
                    "interaction.poll",
                    closed.id(),
                    "interaction.poll_closed",
                    closedBy,
                    Map.of("courseId", courseId, "sessionId", sessionId, "pollId", closed.id()),
                    payload));
        }
    }
}
