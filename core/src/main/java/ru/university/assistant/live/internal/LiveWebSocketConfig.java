package ru.university.assistant.live.internal;

import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import ru.university.assistant.iam.api.AccountAccessRevoked;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.TokenAuthenticationApi;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.shared.api.OriginList;

@Configuration
@EnableWebSocketMessageBroker
class LiveWebSocketConfig implements WebSocketMessageBrokerConfigurer {
    private final TokenAuthenticationApi tokens;
    private final LiveSessionRepository sessions;
    private final CourseAccessApi courseAccess;
    private final List<String> allowedOrigins;
    private final Map<String, Authorization> authorizations = new ConcurrentHashMap<>();
    private final Map<String, WebSocketSession> transports = new ConcurrentHashMap<>();

    LiveWebSocketConfig(TokenAuthenticationApi tokens, LiveSessionRepository sessions,
            CourseAccessApi courseAccess, @Value("${app.security.cors-allowed-origins}") String origins) {
        this.tokens = tokens;
        this.sessions = sessions;
        this.courseAccess = courseAccess;
        this.allowedOrigins = OriginList.parse(origins);
    }

    @Bean
    ThreadPoolTaskScheduler stompHeartbeatScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("stomp-heartbeat-");
        return scheduler;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic").setTaskScheduler(stompHeartbeatScheduler())
                .setHeartbeatValue(new long[] {10000, 10000});
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws/session/{sessionId}")
                .setAllowedOriginPatterns(allowedOrigins.toArray(new String[0]));
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration.setMessageSizeLimit(64 * 1024).setSendBufferSizeLimit(256 * 1024).setSendTimeLimit(5000);
        registration.addDecoratorFactory(handler -> new WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                transports.put(session.getId(), session);
                super.afterConnectionEstablished(session);
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
                transports.remove(session.getId());
                authorizations.remove(session.getId());
                super.afterConnectionClosed(session, status);
            }
        });
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // A slow client must not turn the broker's default unbounded executor
        // queues into an unbounded memory buffer. Rejection is intentional:
        // clients reconnect and recover from the authoritative HTTP snapshot.
        registration.taskExecutor().corePoolSize(2).maxPoolSize(4).queueCapacity(256);
        registration.interceptors(inboundAuthorizationInterceptor());
    }

    ChannelInterceptor inboundAuthorizationInterceptor() {
        return new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor h = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (h == null || h.getCommand() == null) return message;
                String sessionId = h.getSessionId();
                if (h.getCommand() == StompCommand.DISCONNECT) {
                    if (sessionId != null) authorizations.remove(sessionId);
                    return message;
                }
                if (sessionId == null) throw denied();
                if (h.getCommand() == StompCommand.CONNECT) {
                    String token = accessToken(h);
                    AuthenticatedUser user = tokens.parseAccessToken(token).orElseThrow(LiveWebSocketConfig::denied);
                    h.setUser(new UserPrincipal(user.id()));
                    authorizations.put(sessionId, new Authorization(user.id(), token));
                    return message;
                }
                Authorization authorization = authorizations.get(sessionId);
                if (authorization == null) throw denied();
                if (h.getCommand() == StompCommand.SEND) throw denied();
                if (h.getCommand() == StompCommand.SUBSCRIBE) {
                    UUID id = destinationId(h.getDestination());
                    AuthenticatedUser user = tokens.parseAccessToken(authorization.token)
                            .orElseThrow(LiveWebSocketConfig::denied);
                    courseAccess.requireManage(user, sessions.courseId(id));
                    authorization.subscriptions.add(id);
                    authorization.checkedAt = 0;
                } else if (h.getCommand() != StompCommand.UNSUBSCRIBE
                        && h.getCommand() != StompCommand.ACK && h.getCommand() != StompCommand.NACK) {
                    throw denied();
                }
                return message;
            }
        };
    }

    @Override
    public void configureClientOutboundChannel(ChannelRegistration registration) {
        registration.taskExecutor().corePoolSize(2).maxPoolSize(4).queueCapacity(256);
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                SimpMessageHeaderAccessor h = SimpMessageHeaderAccessor.wrap(message);
                if (h.getMessageType() != SimpMessageType.MESSAGE) return message;
                Authorization authorization = authorizations.get(h.getSessionId());
                if (authorization == null || !valid(authorization)) {
                    disconnect(h.getSessionId());
                    return null;
                }
                UUID id;
                try { id = destinationId(h.getDestination()); }
                catch (RuntimeException exception) { return null; }
                return authorization.subscriptions.contains(id) ? message : null;
            }
        });
    }

    @Scheduled(fixedDelay = 1000)
    void revokeExpiredConnections() {
        authorizations.forEach((id, authorization) -> { if (!valid(authorization)) disconnect(id); });
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void revokeAccount(AccountAccessRevoked event) {
        authorizations.forEach((id, authorization) -> {
            if (authorization.personId.equals(event.personId())) disconnect(id);
        });
    }

    private boolean valid(Authorization authorization) {
        long now = System.nanoTime();
        if (authorization.checkedAt != 0 && now - authorization.checkedAt >= 0
                && now - authorization.checkedAt < 1_000_000_000L) return true;
        try {
            AuthenticatedUser user = tokens.parseAccessToken(authorization.token)
                    .orElseThrow(LiveWebSocketConfig::denied);
            for (UUID id : authorization.subscriptions) courseAccess.requireManage(user, sessions.courseId(id));
            authorization.checkedAt = now;
            return true;
        } catch (RuntimeException exception) { return false; }
    }

    private void disconnect(String id) {
        if (id == null) return;
        authorizations.remove(id);
        WebSocketSession session = transports.remove(id);
        if (session != null) {
            try { session.close(CloseStatus.POLICY_VIOLATION); }
            catch (java.io.IOException ignored) { /* The transport already closed. */ }
        }
    }

    private static UUID destinationId(String destination) {
        if (destination == null || !destination.startsWith("/topic/session/")) throw denied();
        try {
            UUID id = UUID.fromString(destination.substring("/topic/session/".length()));
            if (!destination.equals("/topic/session/" + id)) throw denied();
            return id;
        } catch (IllegalArgumentException exception) { throw denied(); }
    }

    private static String accessToken(StompHeaderAccessor h) {
        List<String> headers = h.getNativeHeader("Authorization");
        if (headers == null || headers.size() != 1 || !headers.get(0).startsWith("Bearer ")) throw denied();
        return headers.get(0).substring(7);
    }

    private static AccessDeniedException denied() { return new AccessDeniedException("Session access denied"); }

    private record UserPrincipal(UUID id) implements Principal {
        @Override public String getName() { return id.toString(); }
    }

    private static final class Authorization {
        final UUID personId;
        final String token;
        final Set<UUID> subscriptions = ConcurrentHashMap.newKeySet();
        volatile long checkedAt;
        Authorization(UUID personId, String token) { this.personId = personId; this.token = token; }
    }
}
