package ru.university.assistant.iam.internal.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.ScopedRequestAuthenticationApi;

@Component
class JwtAuthenticationFilter extends OncePerRequestFilter {
    private final JwtService jwtService;
    private final List<ScopedRequestAuthenticationApi> scopedCredentials;

    JwtAuthenticationFilter(JwtService jwtService, List<ScopedRequestAuthenticationApi> scopedCredentials) {
        this.jwtService = jwtService;
        this.scopedCredentials = scopedCredentials;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        for (ScopedRequestAuthenticationApi scoped : scopedCredentials) {
            String credential = request.getHeader(scoped.headerName());
            if (credential == null) continue;
            try {
                var user = scoped.authenticate(request.getMethod(), request.getRequestURI(), credential);
                SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                        user, null, user.getAuthorities()));
            } catch (ResponseStatusException rejected) {
                response.setStatus(rejected.getStatusCode().value());
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write(
                        "{\"error\":\"Lecture control permission expired or request outside scope\"}");
                return;
            }
            filterChain.doFilter(request, response);
            return;
        }
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            jwtService.parse(header.substring(7))
                    .ifPresent(user -> SecurityContextHolder.getContext()
                            .setAuthentication(new UsernamePasswordAuthenticationToken(
                                    user, null, user.getAuthorities())));
        }
        filterChain.doFilter(request, response);
    }
}
