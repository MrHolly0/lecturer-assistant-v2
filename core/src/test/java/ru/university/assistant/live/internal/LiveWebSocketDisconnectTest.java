package ru.university.assistant.live.internal;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.access.AccessDeniedException;
import ru.university.assistant.iam.api.TokenAuthenticationApi;
import ru.university.assistant.org.api.CourseAccessApi;

class LiveWebSocketDisconnectTest {
    @Test
    void disconnectWithoutAuthorizationIsIdempotentAndOtherCommandsStayGuarded() {
        LiveWebSocketConfig config = new LiveWebSocketConfig(
                mock(TokenAuthenticationApi.class), mock(LiveSessionRepository.class), mock(CourseAccessApi.class),
                "http://localhost");
        ChannelInterceptor interceptor = config.inboundAuthorizationInterceptor();
        MessageChannel channel = mock(MessageChannel.class);
        Message<?> disconnect = message(StompCommand.DISCONNECT);

        assertSame(disconnect, interceptor.preSend(disconnect, channel));
        assertSame(disconnect, interceptor.preSend(disconnect, channel));
        assertThrows(AccessDeniedException.class,
                () -> interceptor.preSend(message(StompCommand.SUBSCRIBE), channel));
        assertThrows(AccessDeniedException.class,
                () -> interceptor.preSend(message(StompCommand.SEND), channel));
        assertThrows(AccessDeniedException.class,
                () -> interceptor.preSend(message(StompCommand.CONNECT), channel));
    }

    private Message<byte[]> message(StompCommand command) {
        StompHeaderAccessor headers = StompHeaderAccessor.create(command);
        headers.setSessionId("already-cleaned-session");
        return MessageBuilder.createMessage(new byte[0], headers.getMessageHeaders());
    }
}
