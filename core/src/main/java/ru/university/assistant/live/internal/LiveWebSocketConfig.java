package ru.university.assistant.live.internal;

import java.security.Principal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
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

    LiveWebSocketConfig(
            TokenAuthenticationApi tokens,
            LiveSessionRepository sessions,
            CourseAccessApi courseAccess,
            @Value("${app.security.cors-allowed-origins}") String allowedOrigins) {
        this.tokens = tokens;
        this.sessions = sessions;
        this.courseAccess = courseAccess;
        this.allowedOrigins = OriginList.parse(allowedOrigins);
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // B-13: раньше принимал любой origin ("*"); теперь — только адрес(а) стенда/dev,
        // тот же список, что и в HTTP CORS (app.security.cors-allowed-origins).
        registry.addEndpoint("/ws/session/{sessionId}")
                .setAllowedOriginPatterns(allowedOrigins.toArray(new String[0]));
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor =
                        MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor == null || accessor.getCommand() == null) {
                    return message;
                }
                if (accessor.getCommand() == StompCommand.CONNECT) {
                    return authenticate(message, accessor);
                }
                if (accessor.getCommand() == StompCommand.SUBSCRIBE) {
                    return authorizeSubscription(message, accessor);
                }
                return message;
            }

            private Message<?> authenticate(Message<?> message, StompHeaderAccessor accessor) {
                Optional<AuthenticatedUser> user = token(accessor).flatMap(tokens::parseAccessToken);
                if (user.isEmpty()) {
                    return null;
                }
                accessor.setUser(new UserPrincipal(user.get()));
                return message;
            }

            private Message<?> authorizeSubscription(Message<?> message, StompHeaderAccessor accessor) {
                String destination = accessor.getDestination();
                if (destination == null || !destination.startsWith("/topic/session/")) {
                    return message;
                }
                if (!(accessor.getUser() instanceof UserPrincipal principal)) {
                    return null;
                }
                try {
                    UUID sessionId = UUID.fromString(destination.substring("/topic/session/".length()));
                    sessions.findById(sessionId)
                            .ifPresentOrElse(
                                    session -> courseAccess.requireVisible(principal.user(), session.courseId()),
                                    () -> {
                                        throw new IllegalArgumentException("Session not found");
                                    });
                    return message;
                } catch (RuntimeException exception) {
                    return null;
                }
            }
        });
    }

    private Optional<String> token(StompHeaderAccessor accessor) {
        List<String> values = accessor.getNativeHeader("Authorization");
        if (values == null || values.isEmpty()) {
            return Optional.empty();
        }
        String value = values.get(0);
        return value.startsWith("Bearer ") ? Optional.of(value.substring(7)) : Optional.of(value);
    }

    private record UserPrincipal(AuthenticatedUser user) implements Principal {
        @Override
        public String getName() {
            return user.id().toString();
        }
    }
}
