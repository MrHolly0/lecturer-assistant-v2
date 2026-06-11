package ru.university.assistant.live.internal;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import ru.university.assistant.live.api.LiveSession;

@Component
class LiveSessionPublisher {
    private final SimpMessagingTemplate messaging;

    LiveSessionPublisher(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    void publish(String type, LiveSession session) {
        messaging.convertAndSend("/topic/session/" + session.id(), new LiveSessionMessage(type, session));
    }

    private record LiveSessionMessage(String type, LiveSession session) {}
}
