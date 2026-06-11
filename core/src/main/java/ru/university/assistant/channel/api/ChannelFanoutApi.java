package ru.university.assistant.channel.api;

import ru.university.assistant.live.api.LiveSession;

public interface ChannelFanoutApi {
    void sessionSlideChanged(LiveSession session);
}
