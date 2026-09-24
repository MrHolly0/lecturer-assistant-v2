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
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * B-13, минимум: ограничение частоты на вход через MAX и на отправку сигналов — оба принимают
 * тело без входа (сигналы — по participantToken, не JWT) и оба на каждый вызов пишут в базу,
 * значит оба дёшево заDDoSить с одного клиента. Ключ — IP, а не человек: различать студентов
 * за одним NAT/студенческим Wi-Fi нечем без разбора токена внутри фильтра, а для 150 человек
 * из одной аудитории лимит должен быть достаточно широким, чтобы не зацепить их самих —
 * см. значения по умолчанию в application.yml.
 */
@Component
class RateLimitFilter extends OncePerRequestFilter {
    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();
    private static final String SIGNAL_PATH_PATTERN = "/api/v1/student/sessions/*/signals";

    private final SlidingWindowRateLimiter authMaxLimiter;
    private final SlidingWindowRateLimiter signalLimiter;

    RateLimitFilter(
            @Value("${app.security.rate-limit.auth-max-per-minute}") int authMaxPerMinute,
            @Value("${app.security.rate-limit.signal-per-minute}") int signalPerMinute,
            Clock clock) {
        this.authMaxLimiter = new SlidingWindowRateLimiter(authMaxPerMinute, Duration.ofMinutes(1), clock);
        this.signalLimiter = new SlidingWindowRateLimiter(signalPerMinute, Duration.ofMinutes(1), clock);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        SlidingWindowRateLimiter limiter = limiterFor(request);
        if (limiter != null && !limiter.tryAcquire(clientKey(request))) {
            response.setStatus(429);
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
        if ("/api/v1/auth/max".equals(path)) {
            return authMaxLimiter;
        }
        if (PATH_MATCHER.match(SIGNAL_PATH_PATTERN, path)) {
            return signalLimiter;
        }
        return null;
    }

    // За Caddy на стенде реальный клиентский адрес приходит в X-Forwarded-For; берём первый
    // (ближайший к клиенту) адрес из списка. Заголовку можно верить постольку, поскольку
    // клиент не достаёт до core напрямую — Caddy единственная открытая наружу точка входа.
    private String clientKey(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            return forwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
