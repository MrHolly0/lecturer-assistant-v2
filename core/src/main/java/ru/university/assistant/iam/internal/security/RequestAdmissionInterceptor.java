package ru.university.assistant.iam.internal.security;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.AsyncHandlerInterceptor;
import ru.university.assistant.iam.api.AuthenticatedUser;

/** Admission happens after authentication. Shared-campus addresses are only an anonymous fallback. */
@Component
class RequestAdmissionInterceptor implements AsyncHandlerInterceptor {
    private static final Pattern SLIDE_IMAGE_PATH = Pattern.compile(
            "^/api/v1/courses/[^/]+/decks/[^/]+/slides/[^/]+/image$");
    private static final String PERMIT = RequestAdmissionInterceptor.class.getName() + ".permit";
    private final SlidingWindowRateLimiter reads;
    private final SlidingWindowRateLimiter writes;
    private final SlidingWindowRateLimiter analytics;
    private final SlidingWindowRateLimiter anonymous;
    private final SlidingWindowRateLimiter signals;
    private final SlidingWindowRateLimiter images;
    private final Semaphore requests;
    private final Semaphore expensive;
    private final Counter quotaRejected;
    private final Counter busyRejected;
    private final QuotaCredentialResolver credentials;

    RequestAdmissionInterceptor(Clock clock, MeterRegistry meters, QuotaCredentialResolver credentials,
            @Value("${app.security.admission.reads-per-minute:1200}") int readLimit,
            @Value("${app.security.admission.writes-per-minute:240}") int writeLimit,
            @Value("${app.security.admission.analytics-per-minute:60}") int analyticsLimit,
            @Value("${app.security.admission.anonymous-per-minute:12000}") int anonymousLimit,
            @Value("${app.security.rate-limit.signal-per-minute:6000}") int signalLimit,
            @Value("${app.security.admission.images-per-minute:120000}") int imageLimit,
            @Value("${app.security.admission.maximum-keys:20000}") int maximumKeys,
            @Value("${app.security.admission.concurrent-requests:128}") int concurrentRequests,
            @Value("${app.security.admission.concurrent-analytics:8}") int concurrentAnalytics) {
        this.credentials = credentials;
        reads = new SlidingWindowRateLimiter(readLimit, Duration.ofMinutes(1), clock, maximumKeys);
        writes = new SlidingWindowRateLimiter(writeLimit, Duration.ofMinutes(1), clock, maximumKeys);
        analytics = new SlidingWindowRateLimiter(analyticsLimit, Duration.ofMinutes(1), clock, maximumKeys);
        anonymous = new SlidingWindowRateLimiter(anonymousLimit, Duration.ofMinutes(1), clock, maximumKeys);
        signals = new SlidingWindowRateLimiter(signalLimit, Duration.ofMinutes(1), clock, maximumKeys);
        images = new SlidingWindowRateLimiter(imageLimit, Duration.ofMinutes(1), clock, maximumKeys);
        requests = new Semaphore(Math.max(1, concurrentRequests));
        expensive = new Semaphore(Math.max(1, concurrentAnalytics));
        quotaRejected = meters.counter("api.admission.rejected", "reason", "quota");
        busyRejected = meters.counter("api.admission.rejected", "reason", "concurrency");
        meters.gauge("api.admission.inflight", requests, value -> concurrentRequests - value.availablePermits());
        meters.gauge("api.analytics.inflight", expensive, value -> concurrentAnalytics - value.availablePermits());
        meters.gauge("api.admission.keys", reads, SlidingWindowRateLimiter::keyCount);
        meters.gauge("api.admission.image_keys", images, SlidingWindowRateLimiter::keyCount);
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (request.getAttribute(PERMIT) != null || "OPTIONS".equals(request.getMethod())) return true;
        String path = request.getRequestURI();
        if (path.equals("/api/v1/system/info")) return true;
        boolean expensiveRead = path.contains("/analytics") || path.contains("/summary");
        boolean read = "GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod());
        String subject = subject(request);
        boolean imageRead = read && SLIDE_IMAGE_PATH.matcher(path).matches();
        // Browser image elements cannot send participant headers. They have a separate ingress budget,
        // and still pass the normal signed-URL authorization plus concurrency bound below.
        SlidingWindowRateLimiter quota = imageRead ? images : subject.startsWith("anonymous:") ? anonymous
                : expensiveRead ? analytics : read ? reads : writes;
        if (!quota.tryAcquire(subject)) {
            quotaRejected.increment();
            return reject(response, 429, "Too many requests", quota.retryAfterSeconds(subject));
        }
        if (!read && path.startsWith("/api/v1/student/sessions/") && path.endsWith("/signals")
                && !signals.tryAcquire(subject)) {
            quotaRejected.increment();
            return reject(response, 429, "Too many signals", signals.retryAfterSeconds(subject));
        }
        // SSE only holds this permit until MVC detaches it. Its long-lived clients have a separate bound.
        if (!requests.tryAcquire()) {
            busyRejected.increment();
            return reject(response, 503, "Server is busy; retry later", 2);
        }
        if (expensiveRead && !expensive.tryAcquire()) {
            requests.release();
            busyRejected.increment();
            return reject(response, 503, "Analytics is busy; retry later", 2);
        }
        request.setAttribute(PERMIT, expensiveRead);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
            Object handler, Exception exception) { release(request); }

    @Override
    public void afterConcurrentHandlingStarted(HttpServletRequest request,
            HttpServletResponse response, Object handler) { release(request); }

    private void release(HttpServletRequest request) {
        Object permit = request.getAttribute(PERMIT);
        if (permit == null) return;
        request.removeAttribute(PERMIT);
        if (Boolean.TRUE.equals(permit)) expensive.release();
        requests.release();
    }

    private String subject(HttpServletRequest request) {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AuthenticatedUser user) return "person:" + user.id();
        Object bodyToken = request.getAttribute(JsonBodyBudgetFilter.PARTICIPANT_TOKEN);
        String token = bodyToken instanceof String value && !value.isBlank()
                ? value : request.getHeader("X-Participant-Token");
        String header = "X-Participant-Token";
        if (token == null) {
            token = request.getHeader("X-Projection-View-Token");
            header = "X-Projection-View-Token";
        }
        if (token == null && request.getRequestURI().startsWith("/api/v1/student/")
                && request.getRequestURI().endsWith("/events")) token = request.getParameter("participantToken");
        java.util.Optional<String> subject = credentials.resolve(
                request.getRequestURI(), header, token, request.getRemoteAddr());
        if (subject.isPresent()) return subject.get();
        // Do not trust a caller-supplied Forwarded header. The reverse proxy owns that boundary.
        return "anonymous:" + request.getRemoteAddr();
    }

    private boolean reject(HttpServletResponse response, int status, String message, int retrySeconds)
            throws java.io.IOException {
        response.setStatus(status);
        response.setHeader("Retry-After", Integer.toString(retrySeconds));
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"error\":\"" + message + "\"}");
        return false;
    }
}
