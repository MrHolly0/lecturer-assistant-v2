package ru.university.assistant.iam.internal.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Broad pre-authentication circuit breaker. Authenticated/participant quotas run after authentication. */
@Component
class RateLimitFilter extends OncePerRequestFilter {
    private final SlidingWindowRateLimiter authMaxLimiter;
    private final SlidingWindowRateLimiter passwordLimiter;

    RateLimitFilter(
            @Value("${app.security.rate-limit.auth-max-per-minute}") int authMaxPerMinute,
            Clock clock) {
        this.authMaxLimiter = new SlidingWindowRateLimiter(authMaxPerMinute, Duration.ofMinutes(1), clock);
        this.passwordLimiter = new SlidingWindowRateLimiter(600, Duration.ofMinutes(1), clock);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        SlidingWindowRateLimiter limiter = limiterFor(request);
        if (limiter != null && !limiter.tryAcquire(clientKey(request))) {
            response.setStatus(429);
            response.setHeader("Retry-After", Integer.toString(limiter.retryAfterSeconds(clientKey(request))));
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"error\":\"Too many requests\"}");
            return;
        }
        filterChain.doFilter(request, response);
    }

    private SlidingWindowRateLimiter limiterFor(HttpServletRequest request) {
        if (!"POST".equalsIgnoreCase(request.getMethod())) {
            return null;
        }
        String path = request.getRequestURI();
        if ("/api/v1/auth/login".equals(path) || "/api/v1/auth/register".equals(path)) return passwordLimiter;
        if ("/api/v1/auth/max".equals(path) || path.startsWith("/api/v1/auth/max/")
                || "/api/v1/projection/agent/pair".equals(path)) {
            return authMaxLimiter;
        }
        return null;
    }

    // Forwarded headers are not an authentication boundary. Only the socket peer is trusted here.
    private String clientKey(HttpServletRequest request) { return request.getRemoteAddr(); }
}
