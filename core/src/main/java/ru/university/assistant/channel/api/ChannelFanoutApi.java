package ru.university.assistant.channel.api;

import java.time.Instant;
import java.util.UUID;
import ru.university.assistant.live.api.LiveSession;

public interface ChannelFanoutApi {
    void sessionSlideChanged(LiveSession session);
    void sendSlideToStudent(UUID sessionId, UUID personId, int slideIdx, String imageUrl);
    void sendFrameToStudent(UUID sessionId, UUID personId, UUID shareId, Instant receivedAt, byte[] jpeg);
}
