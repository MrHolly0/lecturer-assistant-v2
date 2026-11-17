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

/**
 * Broad pre-authentication circuit breaker. Authenticated/participant quotas run after
 * authentication.
 */
@Component
class RateLimitFilter extends OncePerRequestFilter {
    private final SlidingWindowRateLimiter authMaxLimiter;
    private final SlidingWindowRateLimiter installationLimiter;
    private final String proxyKey;

    @org.springframework.beans.factory.annotation.Autowired
    RateLimitFilter(
            @Value("${app.security.rate-limit.auth-max-per-minute}") int authMaxPerMinute,
            Clock clock,
            @Value("${TRUSTED_PROXY_KEY:}") String proxyKey,
            @Value("${app.security.rate-limit.auth-installation-per-minute:24000}")
                    int installationLimit) {
        this.proxyKey = proxyKey;
        this.installationLimiter =
                new SlidingWindowRateLimiter(installationLimit, Duration.ofMinutes(1), clock);
        this.authMaxLimiter =
                new SlidingWindowRateLimiter(authMaxPerMinute, Duration.ofMinutes(1), clock);
    }

    RateLimitFilter(int limit, Clock clock) {
        this(limit, clock, "", 24000);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        SlidingWindowRateLimiter limiter = limiterFor(request);
        if (limiter != null
                && (!limiter.tryAcquire(clientKey(request))
                        || !installationLimiter.tryAcquire("installation"))) {
            response.setStatus(429);
            response.setHeader(
                    "Retry-After",
                    Integer.toString(
                            Math.max(
                                    limiter.retryAfterSeconds(clientKey(request)),
                                    installationLimiter.retryAfterSeconds("installation"))));
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
        // PasswordAdmission bounds expensive work by account and concurrency. A shared
        // reverse-proxy/NAT address must not become a university-wide login quota.
        if ("/api/v1/auth/max".equals(path)
                || path.startsWith("/api/v1/auth/max/")
                || "/api/v1/projection/agent/pair".equals(path)) {
            return authMaxLimiter;
        }
        return null;
    }

    private String clientKey(HttpServletRequest request) {
        return TrustedClientAddress.resolve(request, proxyKey);
    }
}
