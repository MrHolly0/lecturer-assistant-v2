package ru.university.assistant.iam.internal.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.org.api.CourseAccessApi;

/** Runs before the multipart resolver reads an upload into temporary storage. */
@Component
class UploadAdmissionFilter extends OncePerRequestFilter {
    private static final Pattern UPLOAD =
            Pattern.compile(
                    "^/api/v1/courses/([0-9a-fA-F-]{36})/(?:decks|lectures/[^/]+/attachments)$");
    private final Semaphore slots = new Semaphore(4);
    private final CourseAccessApi courses;

    UploadAdmissionFilter(CourseAccessApi courses) {
        this.courses = courses;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        var path = UPLOAD.matcher(request.getRequestURI());
        if (!"POST".equals(request.getMethod()) || !path.matches()) {
            chain.doFilter(request, response);
            return;
        }
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null
                || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            response.sendError(401);
            return;
        }
        try {
            courses.requireManage(user, UUID.fromString(path.group(1)));
        } catch (org.springframework.web.server.ResponseStatusException denied) {
            response.sendError(denied.getStatusCode().value());
            return;
        }
        if (!slots.tryAcquire()) {
            response.setHeader("Retry-After", "3");
            response.sendError(429);
            return;
        }
        try {
            chain.doFilter(request, response);
        } finally {
            slots.release();
        }
    }
}
