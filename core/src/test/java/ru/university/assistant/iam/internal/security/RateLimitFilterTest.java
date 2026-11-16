package ru.university.assistant.iam.internal.security;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RateLimitFilterTest {
    private static final String PROXY = "isolated-proxy-credential-0000000000000000";

    @Test
    void verifiedIngressSeparatesSourcesWhileSpoofedHeadersCannotChangeTheSocketIdentity()
            throws Exception {
        RateLimitFilter filter = new RateLimitFilter(2, Clock.systemUTC(), PROXY, 100);
        for (int i = 0; i < 3; i++)
            assertEquals(i < 2 ? 200 : 429, request(filter, "192.0.2.1", PROXY, "10.0.0.1"));
        assertEquals(200, request(filter, "192.0.2.2", PROXY, "10.0.0.1"));
        assertEquals(200, request(filter, "192.0.2.100", "wrong", "10.0.0.2"));
        assertEquals(200, request(filter, "192.0.2.101", "wrong", "10.0.0.2"));
        assertEquals(429, request(filter, "192.0.2.102", "wrong", "10.0.0.2"));
    }

    @Test
    void installationBudgetIsIndependentOfTheVerifiedSourceBudgets() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(10, Clock.systemUTC(), PROXY, 3);
        for (int i = 1; i <= 4; i++)
            assertEquals(i <= 3 ? 200 : 429, request(filter, "192.0.2." + i, PROXY, "10.0.0.1"));
    }

    private int request(RateLimitFilter filter, String client, String key, String peer)
            throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/max");
        request.setRemoteAddr(peer);
        request.addHeader("X-Lecturer-Client-IP", client);
        request.addHeader("X-Lecturer-Proxy-Key", key);
        request.addHeader("X-Forwarded-For", "198.51.100.1");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response.getStatus();
    }

    @Test
    void arbitraryForwardedHeadersDoNotResetPreAuthAllowance() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(2, Clock.systemUTC());
        for (int index = 0; index < 3; index++) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/max");
            request.setRemoteAddr("127.0.0.1");
            request.addHeader("X-Forwarded-For", "spoofed-" + index + ", 127.0.0.1");
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(request, response, new MockFilterChain());
            assertEquals(index < 2 ? 200 : 429, response.getStatus());
            if (index == 2) assertEquals("30", response.getHeader("Retry-After"));
        }
    }
}
