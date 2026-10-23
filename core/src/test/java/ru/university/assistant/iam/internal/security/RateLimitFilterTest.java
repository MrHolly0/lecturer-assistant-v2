package ru.university.assistant.iam.internal.security;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RateLimitFilterTest {
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
