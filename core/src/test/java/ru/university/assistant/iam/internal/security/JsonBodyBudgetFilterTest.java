package ru.university.assistant.iam.internal.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import jakarta.servlet.http.HttpServletRequestWrapper;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class JsonBodyBudgetFilterTest {
    @Test
    void quotaHintUsesLastRootTokenAndIgnoresNestedTokens() throws Exception {
        var filter = new JsonBodyBudgetFilter();
        var request = json(("{\"participantToken\":\"first\",\"nested\":{\"participantToken\":\"wrong\"},"
                + "\"participantToken\":\"last\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        request.setRequestURI("/api/v1/student/sessions/test/signals");
        filter.doFilter(request, new MockHttpServletResponse(), (req, res) ->
                assertEquals("last", req.getAttribute(JsonBodyBudgetFilter.PARTICIPANT_TOKEN)));
        var cleared = json("{\"participantToken\":\"first\",\"participantToken\":null}"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        cleared.setRequestURI(request.getRequestURI());
        filter.doFilter(cleared, new MockHttpServletResponse(), (req, res) ->
                org.junit.jupiter.api.Assertions.assertNull(req.getAttribute(JsonBodyBudgetFilter.PARTICIPANT_TOKEN)));
    }

    @Test
    void smallJsonBurstDoesNotConsumeTheLargeBodyBudget() throws Exception {
        var filter = new JsonBodyBudgetFilter();
        var entered = new CountDownLatch(24);
        var release = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(24);
        try {
            var tasks = java.util.stream.IntStream.range(0, 24).mapToObj(i -> pool.submit(() -> {
                var response = new MockHttpServletResponse();
                try {
                    filter.doFilter(json(new byte[] {1}), response, (req, res) -> {
                        entered.countDown();
                        try { release.await(5, TimeUnit.SECONDS); }
                        catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
                    });
                    assertEquals(200, response.getStatus());
                } catch (Exception exception) { throw new RuntimeException(exception); }
            })).toList();
            org.junit.jupiter.api.Assertions.assertTrue(entered.await(5, TimeUnit.SECONDS));
            release.countDown();
            for (var task : tasks) task.get(5, TimeUnit.SECONDS);
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test
    void rejectsOversizeUnknownLengthBodyBeforeParsingAndPreservesSmallBodies() throws Exception {
        var filter = new JsonBodyBudgetFilter();
        var request = json(new byte[JsonBodyBudgetFilter.MAX_BYTES + 1]);
        request.setContentType("application/vnd.api+json ; charset=utf-8");
        var unknown = new HttpServletRequestWrapper(request) {
            @Override
            public long getContentLengthLong() { return -1; }
        };
        var response = new MockHttpServletResponse();
        var parsed = new AtomicBoolean();
        filter.doFilter(unknown, response, (req, res) -> parsed.set(true));
        assertEquals(413, response.getStatus());
        assertFalse(parsed.get());
        var small = json("{\"text\":\"test\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        filter.doFilter(small, new MockHttpServletResponse(), (req, res) ->
                assertEquals("{\"text\":\"test\"}", new String(req.getInputStream().readAllBytes(),
                        java.nio.charset.StandardCharsets.UTF_8)));
    }

    @Test
    void concurrentJsonBudgetRejectsExcessAndReleasesPermits() throws Exception {
        var filter = new JsonBodyBudgetFilter();
        var entered = new CountDownLatch(16);
        var release = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(16);
        byte[] large = new byte[JsonBodyBudgetFilter.MAX_BYTES];
        try {
            var tasks = java.util.stream.IntStream.range(0, 16).mapToObj(i -> pool.submit(() -> {
                try {
                    filter.doFilter(json(large), new MockHttpServletResponse(), (req, res) -> {
                        entered.countDown();
                        try { release.await(5, TimeUnit.SECONDS); }
                        catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
                    });
                } catch (Exception exception) { throw new RuntimeException(exception); }
            })).toList();
            org.junit.jupiter.api.Assertions.assertTrue(entered.await(5, TimeUnit.SECONDS));
            var response = new MockHttpServletResponse();
            filter.doFilter(json(new byte[1]), response, (req, res) -> { throw new AssertionError("must reject"); });
            assertEquals(503, response.getStatus());
            assertEquals("2", response.getHeader("Retry-After"));
            release.countDown();
            for (var task : tasks) task.get(5, TimeUnit.SECONDS);
            response = new MockHttpServletResponse();
            filter.doFilter(json(new byte[0]), response, (req, res) -> {});
            assertEquals(200, response.getStatus());
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    private MockHttpServletRequest json(byte[] body) {
        var request = new MockHttpServletRequest("POST", "/api/v1/test");
        request.setContentType("application/json"); request.setContent(body); return request;
    }
}
