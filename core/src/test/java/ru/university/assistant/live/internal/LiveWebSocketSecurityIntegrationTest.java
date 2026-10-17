package ru.university.assistant.live.internal;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.context.annotation.Import;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@org.springframework.boot.test.context.SpringBootTest(webEnvironment =
        org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(LiveWebSocketSecurityIntegrationTest.ClockTestConfiguration.class)
class LiveWebSocketSecurityIntegrationTest {
    private static final String ADMIN_SETUP_TOKEN = "websocket-security-test-admin-setup-token";
    private static final String JWT_SECRET = "websocket-security-test-secret-with-sufficient-length";

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @LocalServerPort
    int port;

    @Autowired
    TestRestTemplate http;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    MutableClock clock;

    private WebSocketStompClient stompClient;
    private String adminToken;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("app.security.jwt-secret", () -> JWT_SECRET);
        registry.add("app.security.admin-setup-token", () -> ADMIN_SETUP_TOKEN);
        registry.add("app.security.access-token-minutes", () -> "5");
        registry.add("app.content.blob-root", () -> System.getProperty("java.io.tmpdir")
                + "/lecturer-assistant-ws-security-"
                + UUID.randomUUID());
    }

    @BeforeEach
    void createStompClient() throws Exception {
        clock.set(Instant.now());
        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.start();
        adminToken = post("/api/v1/auth/bootstrap-admin", null,
                        "{\"displayName\":\"Admin\",\"email\":\"admin@example.test\","
                                + "\"password\":\"password-123\"}", 200)
                .path("accessToken")
                .asText();
        assertEquals("ADMIN", get("/api/v1/auth/me", adminToken).path("role").asText());
    }

    @AfterEach
    void stopStompClient() {
        if (stompClient != null) stompClient.stop();
    }

    @Test
    void realStompEnforcesDestinationAndLiveAccountAuthorization() throws Exception {
        Staff own = createStaff("own");
        UUID ownSession = createSession(own, "Own course");
        Staff foreign = createStaff("foreign");
        UUID foreignSession = createSession(foreign, "Foreign course");
        Staff expiring = createStaff("expiring");
        UUID expiringSession = createSession(expiring, "Expiring course");

        ClientEvents ownEvents = new ClientEvents();
        StompSession valid = connect(own.token(), ownSession, ownEvents);
        valid.subscribe("/topic/session/" + ownSession, ownEvents);
        Thread.sleep(150);
        post("/api/v1/courses/" + own.courseId() + "/sessions/" + ownSession + "/begin", own.token(), "{}", 200);
        assertTrue(ownEvents.message.await(3, TimeUnit.SECONDS), "Own session subscription should receive an update");
        assertNotNull(ownEvents.payload.get());
        valid.disconnect();

        assertRejectedSubscribe(own.token(), ownSession, "/topic/session/*");
        assertRejectedSubscribe(own.token(), ownSession, "/topic/session/" + foreignSession);
        assertRejectedSend(own.token(), ownSession, "/app/session/" + ownSession + "/slide");

        ClientEvents disabledEvents = new ClientEvents();
        StompSession disabled = connect(own.token(), ownSession, disabledEvents);
        disabled.subscribe("/topic/session/" + ownSession, disabledEvents);
        put("/api/v1/admin/users/" + own.personId() + "/status", adminToken,
                "{\"status\":\"DISABLED\"}", 200);
        assertTrue(disabledEvents.closed.await(4, TimeUnit.SECONDS), "Disabled account should lose its socket");

        ClientEvents roleEvents = new ClientEvents();
        StompSession changedRole = connect(foreign.token(), foreignSession, roleEvents);
        changedRole.subscribe("/topic/session/" + foreignSession, roleEvents);
        put("/api/v1/admin/users/" + foreign.personId() + "/role", adminToken,
                "{\"role\":\"ASSISTANT\"}", 200);
        assertTrue(roleEvents.closed.await(4, TimeUnit.SECONDS), "Role change should revoke the old token socket");

        ClientEvents expiryEvents = new ClientEvents();
        StompSession expiringSessionClient = connect(expiring.token(), expiringSession, expiryEvents);
        expiringSessionClient.subscribe("/topic/session/" + expiringSession, expiryEvents);
        clock.advance(Duration.ofMinutes(6));
        assertTrue(expiryEvents.closed.await(4, TimeUnit.SECONDS), "Expired token should lose its socket");
        assertFalse(expiringSessionClient.isConnected());
    }

    private void assertRejectedSubscribe(String token, UUID endpointSession, String destination) throws Exception {
        ClientEvents events = new ClientEvents();
        StompSession session = connect(token, endpointSession, events);
        session.subscribe(destination, events);
        assertTrue(events.closed.await(4, TimeUnit.SECONDS), "Rejected subscription should close the STOMP socket");
        assertFalse(session.isConnected());
    }

    private void assertRejectedSend(String token, UUID endpointSession, String destination) throws Exception {
        ClientEvents events = new ClientEvents();
        StompSession session = connect(token, endpointSession, events);
        session.send(destination, "unauthorized".getBytes(StandardCharsets.UTF_8));
        assertTrue(events.closed.await(4, TimeUnit.SECONDS), "Client SEND should close the STOMP socket");
        assertFalse(session.isConnected());
    }

    private StompSession connect(String token, UUID endpointSession, ClientEvents events) throws Exception {
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add("Authorization", "Bearer " + token);
        WebSocketHttpHeaders handshakeHeaders = new WebSocketHttpHeaders();
        handshakeHeaders.setOrigin("http://localhost:5173");
        return stompClient.connectAsync(
                        "ws://localhost:" + port + "/ws/session/" + endpointSession,
                        handshakeHeaders, connectHeaders, events)
                .get(5, TimeUnit.SECONDS);
    }

    private Staff createStaff(String tag) throws Exception {
        String email = tag + "-" + UUID.randomUUID() + "@example.test";
        String invite = post("/api/v1/admin/invitations", adminToken, "{\"role\":\"LECTURER\"}", 201)
                .path("code")
                .asText();
        JsonNode registration = post("/api/v1/auth/register", null, "{\"invitationCode\":\"" + invite
                + "\",\"displayName\":\"" + tag + "\",\"email\":\"" + email
                + "\",\"password\":\"password-123\"}", 200);
        String token = registration.path("accessToken").asText();
        UUID personId = UUID.fromString(registration.path("user").path("id").asText());
        UUID courseId = UUID.fromString(post("/api/v1/courses", token, "{\"title\":\"" + tag + " course\"}", 201)
                .path("id")
                .asText());
        return new Staff(token, personId, courseId);
    }

    private UUID createSession(Staff staff, String title) {
        String token = staff.token();
        UUID courseId = staff.courseId();
        UUID deckId = UUID.randomUUID();
        jdbc.sql("""
                        insert into content.slide_decks
                            (id, course_id, title, version, source_file_ref, source_filename,
                             source_content_type, source_size_bytes)
                        values (:id, :courseId, 'Deck', 1, 'ws-test/source.pdf', 'source.pdf', 'application/pdf', 100)
                        """)
                .param("id", deckId)
                .param("courseId", courseId)
                .update();
        UUID lectureId = UUID.fromString(post("/api/v1/courses/" + courseId + "/lectures", token,
                        "{\"title\":\"" + title + " lecture\",\"deckId\":\"" + deckId + "\"}", 201)
                .path("id")
                .asText());
        return UUID.fromString(post("/api/v1/courses/" + courseId + "/lectures/" + lectureId + "/sessions", token,
                        "{\"groups\":[{\"groupName\":\"Group\"}]}", 201)
                .path("id")
                .asText());
    }

    private JsonNode get(String path, String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        ResponseEntity<JsonNode> response = http.exchange(
                path, HttpMethod.GET, new HttpEntity<>(headers), JsonNode.class);
        assertTrue(response.getStatusCode().is2xxSuccessful(),
                "GET " + path + " returned " + response.getStatusCode() + ": " + response.getBody());
        return response.getBody();
    }

    private JsonNode post(String path, String token, String json, int expected) {
        return request(HttpMethod.POST, path, token, json, expected);
    }

    private JsonNode put(String path, String token, String json, int expected) {
        return request(HttpMethod.PUT, path, token, json, expected);
    }

    private JsonNode request(HttpMethod method, String path, String token, String json, int expected) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) headers.setBearerAuth(token);
        if (path.endsWith("/bootstrap-admin")) headers.set("X-Admin-Setup-Token", ADMIN_SETUP_TOKEN);
        ResponseEntity<JsonNode> response = http.exchange(
                path, method, new HttpEntity<>(json, headers), JsonNode.class);
        assertTrue(response.getStatusCode().value() == expected,
                method + " " + path + " returned " + response.getStatusCode() + ": " + response.getBody());
        return response.getBody();
    }

    private record Staff(String token, UUID personId, UUID courseId) {}

    private static final class ClientEvents extends StompSessionHandlerAdapter implements StompFrameHandler {
        private final CountDownLatch message = new CountDownLatch(1);
        private final CountDownLatch closed = new CountDownLatch(1);
        private final AtomicReference<Object> payload = new AtomicReference<>();

        @Override
        public void handleFrame(StompHeaders headers, Object payload) {
            this.payload.set(payload);
            message.countDown();
        }

        @Override
        public void handleTransportError(StompSession session, Throwable exception) {
            closed.countDown();
        }

        @Override
        public java.lang.reflect.Type getPayloadType(StompHeaders headers) {
            return byte[].class;
        }

        @Override
        public void afterConnected(StompSession session, StompHeaders connectedHeaders) {
            // Connection completion is observed through connectAsync.
        }
    }

    @TestConfiguration
    static class ClockTestConfiguration {
        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock();
        }
    }

    static final class MutableClock extends Clock {
        private final AtomicReference<Instant> instant = new AtomicReference<>(Instant.EPOCH);

        void set(Instant value) {
            instant.set(value);
        }

        void advance(Duration duration) {
            instant.updateAndGet(value -> value.plus(duration));
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant.get();
        }
    }
}
