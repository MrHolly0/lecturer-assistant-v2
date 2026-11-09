package ru.university.assistant.projection.internal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class SfuTicketClientTest {
    @Test
    void internalJsonRpcDoesNotNegotiateH2cOnTheWebsocketListener() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> upgrade = new AtomicReference<>();
        AtomicReference<String> key = new AtomicReference<>();
        server.createContext("/internal/v1/media/ticket", exchange -> {
            upgrade.set(exchange.getRequestHeaders().getFirst("Upgrade"));
            key.set(exchange.getRequestHeaders().getFirst("X-Service-Key"));
            exchange.getRequestBody().readAllBytes();
            byte[] bytes = "{\"room\":\"test-room\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        try {
            var client = new SfuTicketClient(RestClient.builder(),
                    "http://127.0.0.1:" + server.getAddress().getPort(), "service-test-key");
            assertEquals(java.util.Map.of("room", "test-room"), client.ticket(UUID.randomUUID()));
            assertNull(upgrade.get());
            assertEquals("service-test-key", key.get());
        } finally { server.stop(0); }
    }
}
