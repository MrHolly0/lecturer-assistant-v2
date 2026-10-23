package ru.university.assistant.iam.internal.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Bound JSON before Jackson allocates an object graph. Multipart/media have separate limits. */
@Component
class JsonBodyBudgetFilter extends OncePerRequestFilter {
    static final int MAX_BYTES = 4 * 1024 * 1024;
    static final String PARTICIPANT_TOKEN = JsonBodyBudgetFilter.class.getName() + ".participantToken";
    private static final com.fasterxml.jackson.core.JsonFactory JSON = new com.fasterxml.jackson.core.JsonFactory();
    private static final long TOTAL_BYTES = 64L * 1024 * 1024;
    private final Semaphore parsing = new Semaphore(128);
    private final AtomicLong bufferedBytes = new AtomicLong();

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String type = request.getContentType();
        boolean json = type != null && (type.toLowerCase(Locale.ROOT).startsWith("application/json")
                || type.toLowerCase(Locale.ROOT).split(";", 2)[0].trim().endsWith("+json"));
        if (!json || "GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod())) {
            chain.doFilter(request, response); return;
        }
        if (request.getContentLengthLong() > MAX_BYTES) {
            reject(response, 413, "JSON body is too large"); return;
        }
        if (!parsing.tryAcquire()) {
            response.setHeader("Retry-After", "2");
            reject(response, 503, "Too many concurrent JSON commands"); return;
        }
        long reserved = 0;
        try {
            var output = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int count;
            var input = request.getInputStream();
            while ((count = input.read(chunk, 0, Math.min(chunk.length, MAX_BYTES + 1 - output.size()))) != -1) {
                if (output.size() + count > MAX_BYTES) {
                    reject(response, 413, "JSON body is too large"); return;
                }
                if (!reserve(count)) {
                    response.setHeader("Retry-After", "2");
                    reject(response, 503, "JSON memory budget is busy"); return;
                }
                reserved += count;
                output.write(chunk, 0, count);
            }
            byte[] body = output.toByteArray();
            if (request.getRequestURI().startsWith("/api/v1/student/sessions/")) {
                extractParticipantToken(request, body);
            }
            chain.doFilter(new BufferedJsonRequest(request, body), response);
        } finally {
            bufferedBytes.addAndGet(-reserved);
            parsing.release();
        }
    }

    private void extractParticipantToken(HttpServletRequest request, byte[] body) {
        try (var parser = JSON.createParser(body)) {
            if (parser.nextToken() != com.fasterxml.jackson.core.JsonToken.START_OBJECT) return;
            while (parser.nextToken() == com.fasterxml.jackson.core.JsonToken.FIELD_NAME) {
                String name = parser.currentName();
                var value = parser.nextToken();
                if ("participantToken".equals(name)) {
                    // Match Jackson's last-root-field-wins semantics, including a final null value.
                    request.removeAttribute(PARTICIPANT_TOKEN);
                    if (value == com.fasterxml.jackson.core.JsonToken.VALUE_STRING && parser.getTextLength() <= 512) {
                        request.setAttribute(PARTICIPANT_TOKEN, parser.getText());
                    }
                }
                parser.skipChildren();
            }
        } catch (IOException malformed) {
            // Business deserialization remains responsible for malformed JSON responses.
        }
    }

    private boolean reserve(int count) {
        long used;
        do {
            used = bufferedBytes.get();
            if (used + count > TOTAL_BYTES) return false;
        } while (!bufferedBytes.compareAndSet(used, used + count));
        return true;
    }

    private void reject(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"error\":\"" + message + "\"}");
    }

    private static class BufferedJsonRequest extends HttpServletRequestWrapper {
        private final byte[] body;
        BufferedJsonRequest(HttpServletRequest request, byte[] body) { super(request); this.body = body; }
        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream input = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public int read() { return input.read(); }
                @Override
                public int read(byte[] bytes, int offset, int length) { return input.read(bytes, offset, length); }
                @Override
                public boolean isFinished() { return input.available() == 0; }
                @Override
                public boolean isReady() { return true; }
                @Override
                public void setReadListener(ReadListener listener) {
                    throw new UnsupportedOperationException("JSON command bodies use blocking MVC reads");
                }
            };
        }
        @Override
        public BufferedReader getReader() {
            return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
        }
    }
}
