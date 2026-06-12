package ru.university.assistant.feedback.internal;

import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.university.assistant.analytics.api.DomainEvent;
import ru.university.assistant.analytics.api.EventBus;
import ru.university.assistant.feedback.api.FeedbackApi;
import ru.university.assistant.feedback.api.SignalAggregate;
import ru.university.assistant.feedback.api.SignalValue;

@Service
class FeedbackService implements FeedbackApi {
    private final FeedbackRepository repository;
    private final EventBus events;

    FeedbackService(FeedbackRepository repository, EventBus events) {
        this.repository = repository;
        this.events = events;
    }

    @Override
    @Transactional
    public SignalAggregate saveSignal(UUID sessionId, UUID personId, String channelType, SignalValue value) {
        repository.saveSignal(sessionId, personId, channelType, value);
        events.publish(new DomainEvent(
                "feedback.comprehension_signal",
                sessionId,
                "feedback.signal_submitted",
                personId,
                Map.of("sessionId", sessionId),
                Map.of("channelType", channelType, "value", value.name())));
        return repository.aggregate(sessionId);
    }

    @Override
    public SignalAggregate aggregate(UUID sessionId) {
        return repository.aggregate(sessionId);
    }
}
