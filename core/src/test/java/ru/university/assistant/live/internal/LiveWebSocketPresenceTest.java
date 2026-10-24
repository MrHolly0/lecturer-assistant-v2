package ru.university.assistant.live.internal;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.PersonRole;
import ru.university.assistant.iam.api.TokenAuthenticationApi;
import ru.university.assistant.org.api.CourseAccessApi;

class LiveWebSocketPresenceTest {
    @Test
    void anyOpenPresenterKeepsPresenceButUnsubscribedOrClosedSocketsDoNot() throws Exception {
        UUID sessionId = UUID.randomUUID();
        TokenAuthenticationApi tokens = mock(TokenAuthenticationApi.class);
        LiveSessionRepository sessions = mock(LiveSessionRepository.class);
        when(tokens.parseAccessToken(any())).thenReturn(Optional.of(new AuthenticatedUser(
                UUID.randomUUID(), "Teacher", "fixture@example.test", PersonRole.LECTURER)));
        when(sessions.courseId(sessionId)).thenReturn(UUID.randomUUID());
        LiveWebSocketConfig config = new LiveWebSocketConfig(
                tokens, sessions, mock(CourseAccessApi.class), "http://localhost");
        TransportRegistration registration = new TransportRegistration();
        config.configureWebSocketTransport(registration);
        WebSocketHandler handler = registration.handler();
        WebSocketSession main = transport("main");
        WebSocketSession remote = transport("remote");
        handler.afterConnectionEstablished(main);
        handler.afterConnectionEstablished(remote);
        ChannelInterceptor inbound = config.inboundAuthorizationInterceptor();
        send(inbound, "main", StompCommand.CONNECT, null, sessionId);
        send(inbound, "remote", StompCommand.CONNECT, null, sessionId);
        send(inbound, "main", StompCommand.SUBSCRIBE, "main-sub", sessionId);
        send(inbound, "remote", StompCommand.SUBSCRIBE, "remote-sub", sessionId);
        clearInvocations(sessions);
        config.retainConnectedPresenters();
        verify(sessions).touchPresenter(sessionId);

        handler.afterConnectionClosed(main, CloseStatus.NORMAL);
        clearInvocations(sessions);
        config.retainConnectedPresenters();
        verify(sessions).touchPresenter(sessionId);

        send(inbound, "remote", StompCommand.UNSUBSCRIBE, "remote-sub", sessionId);
        clearInvocations(sessions);
        config.retainConnectedPresenters();
        verifyNoInteractions(sessions);
        handler.afterConnectionClosed(remote, CloseStatus.NORMAL);
    }

    private WebSocketSession transport(String id) {
        WebSocketSession transport = mock(WebSocketSession.class);
        when(transport.getId()).thenReturn(id);
        when(transport.isOpen()).thenReturn(true);
        return transport;
    }

    private void send(ChannelInterceptor inbound, String socket, StompCommand command, String subscription, UUID id) {
        StompHeaderAccessor headers = StompHeaderAccessor.create(command);
        headers.setSessionId(socket);
        headers.setNativeHeader("Authorization", "Bearer fixture");
        if (subscription != null) headers.setSubscriptionId(subscription);
        if (command == StompCommand.SUBSCRIBE) headers.setDestination("/topic/session/" + id);
        headers.setLeaveMutable(true);
        inbound.preSend(MessageBuilder.createMessage(new byte[0], headers.getMessageHeaders()),
                mock(MessageChannel.class));
    }

    private static final class TransportRegistration extends WebSocketTransportRegistration {
        WebSocketHandler handler() { return getDecoratorFactories().getFirst().decorate(new TextWebSocketHandler()); }
    }
}
