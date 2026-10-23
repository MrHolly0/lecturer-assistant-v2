package ru.university.assistant.shared.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class OperationsMetricsControllerTest {
    @Test
    void internalKeyIsRequiredAndOnlyBoundedSafeMetricsAreReturned() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        registry.counter("live.sse.snapshot_rejections", "session", "private-session").increment();
        registry.counter("unrelated.private", "token", "private-token").increment();
        OperationsMetricsController controller = new OperationsMetricsController(registry, "operator-secret");
        assertEquals(401, assertThrows(ResponseStatusException.class, () -> controller.snapshot(null))
                .getStatusCode().value());
        assertEquals(401, assertThrows(ResponseStatusException.class, () -> controller.snapshot("wrong"))
                .getStatusCode().value());
        String result = controller.snapshot("operator-secret").toString();
        assertTrue(result.contains("live.sse.snapshot_rejections"));
        assertFalse(result.contains("private-session"));
        assertFalse(result.contains("private-token"));
        assertFalse(result.contains("unrelated.private"));
    }
}
