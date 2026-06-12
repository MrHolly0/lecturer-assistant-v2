package ru.university.assistant.feedback.api;

import java.util.UUID;

public interface FeedbackApi {
    SignalAggregate saveSignal(UUID sessionId, UUID personId, String channelType, SignalValue value);

    SignalAggregate aggregate(UUID sessionId);
}
