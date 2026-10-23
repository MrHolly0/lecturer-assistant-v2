package ru.university.assistant.iam.internal.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.iam.api.CredentialQuotaSubjectApi;
import ru.university.assistant.iam.api.PersonRole;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RequestAdmissionInterceptorTest {
    private RequestAdmissionInterceptor limiter(int concurrent, int analytics) {
        return new RequestAdmissionInterceptor(Clock.systemUTC(), new SimpleMeterRegistry(), credentials(),
                2, 2, 2, 10_000, 6000, 120_000, 10, concurrent, analytics);
    }

    @Test
    void participantsBehindOneCampusAddressHaveIndependentBudgets() throws Exception {
        RequestAdmissionInterceptor gate = limiter(10, 1);
        for (int i = 0; i < 2; i++) complete(gate, request("one", "/api/v1/student/sessions/ONE"));
        MockHttpServletResponse rejected = new MockHttpServletResponse();
        assertFalse(gate.preHandle(request("one", "/api/v1/student/sessions/ONE"), rejected, this));
        assertEquals(429, rejected.getStatus());
        assertEquals("30", rejected.getHeader("Retry-After"));
        complete(gate, request("two", "/api/v1/student/sessions/ONE"));
    }

    @Test
    void concurrentAdmissionIsReleasedOnceOnAsyncDetachAndNotByRejectedRequests() throws Exception {
        RequestAdmissionInterceptor gate = limiter(1, 1);
        MockHttpServletRequest first = request("one", "/api/v1/student/sessions/ONE/events");
        assertTrue(gate.preHandle(first, new MockHttpServletResponse(), this));
        MockHttpServletRequest second = request("two", "/api/v1/student/sessions/TWO");
        MockHttpServletResponse rejected = new MockHttpServletResponse();
        assertFalse(gate.preHandle(second, rejected, this));
        assertEquals(503, rejected.getStatus());
        gate.afterCompletion(second, rejected, this, null);
        assertFalse(gate.preHandle(request("three", "/api/v1/student/sessions/THREE"),
                new MockHttpServletResponse(), this));
        gate.afterConcurrentHandlingStarted(first, new MockHttpServletResponse(), this);
        gate.afterCompletion(first, new MockHttpServletResponse(), this, null);
        complete(gate, request("four", "/api/v1/student/sessions/FOUR"));
    }

    @Test
    void analyticsHasItsOwnConcurrencyBudget() throws Exception {
        RequestAdmissionInterceptor gate = limiter(3, 1);
        MockHttpServletRequest analytics = request("one", "/api/v1/courses/one/analytics");
        assertTrue(gate.preHandle(analytics, new MockHttpServletResponse(), this));
        MockHttpServletResponse rejected = new MockHttpServletResponse();
        assertFalse(gate.preHandle(request("two", "/api/v1/courses/two/analytics"), rejected, this));
        assertEquals(503, rejected.getStatus());
        complete(gate, request("three", "/api/v1/student/sessions/THREE"));
        gate.afterCompletion(analytics, new MockHttpServletResponse(), this, null);
        complete(gate, request("four", "/api/v1/courses/four/analytics"));
    }

    @Test
    void campusImageLoadsDoNotConsumeAnonymousCommandsAndRemainIndependentlyBounded() throws Exception {
        RequestAdmissionInterceptor gate = new RequestAdmissionInterceptor(Clock.systemUTC(),
                new SimpleMeterRegistry(), credentials(), 2, 2, 2, 2, 6000, 3, 10, 10, 1);
        String path = "/api/v1/courses/course/decks/deck/slides/1/image";
        for (int index = 0; index < 3; index++) {
            complete(gate, new MockHttpServletRequest("GET", path));
        }
        MockHttpServletResponse rejected = new MockHttpServletResponse();
        assertFalse(gate.preHandle(new MockHttpServletRequest("GET", path), rejected, this));
        assertEquals(429, rejected.getStatus());
        assertEquals("20", rejected.getHeader("Retry-After"));
        complete(gate, new MockHttpServletRequest("POST", "/api/v1/student/sessions/ONE/join"));
        complete(gate, new MockHttpServletRequest("POST", "/api/v1/student/sessions/TWO/join"));
        assertFalse(gate.preHandle(new MockHttpServletRequest("POST", "/api/v1/student/sessions/THREE/join"),
                new MockHttpServletResponse(), this));
    }

    @Test
    void garbageCredentialsCannotFillPersonalQuotasOrBlockNewVerifiedGuestsAndAccounts() throws Exception {
        SimpleMeterRegistry meters = new SimpleMeterRegistry();
        QuotaCredentialResolver credentials = credentials(meters);
        RequestAdmissionInterceptor gate = new RequestAdmissionInterceptor(Clock.systemUTC(), meters, credentials,
                2, 2, 2, 10_000, 6000, 120_000, 2, 10, 1);
        for (int index = 0; index < 20_000; index++) {
            MockHttpServletRequest request = request("garbage-" + index, "/api/v1/student/sessions/ONE");
            MockHttpServletResponse response = new MockHttpServletResponse();
            if (gate.preHandle(request, response, this)) gate.afterCompletion(request, response, this, null);
            else assertEquals(429, response.getStatus());
        }
        assertEquals(0, credentials.size());
        assertEquals(0.0, meters.get("api.admission.keys").gauge().value());
        complete(gate, request("verified-guest", "/api/v1/student/sessions/ONE"));
        AuthenticatedUser user = new AuthenticatedUser(UUID.randomUUID(), "Lecturer", "staff@example.test",
                PersonRole.LECTURER);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
        try { complete(gate, request("garbage-header", "/api/v1/student/sessions/ONE")); }
        finally { SecurityContextHolder.clearContext(); }
        assertEquals(2.0, meters.get("api.admission.keys").gauge().value());
    }

    @Test
    void legacyBodyCredentialUsesTheActualParticipantAndRandomHeadersCannotSplitItsWriteQuota() throws Exception {
        RequestAdmissionInterceptor gate = limiter(10, 1);
        for (String header : List.of("one", "two")) {
            MockHttpServletRequest request = new MockHttpServletRequest(
                    "POST", "/api/v1/student/sessions/ONE/questions");
            request.addHeader("X-Participant-Token", header);
            request.setAttribute(JsonBodyBudgetFilter.PARTICIPANT_TOKEN, "actual-participant");
            complete(gate, request);
        }
        MockHttpServletRequest rejected = new MockHttpServletRequest("POST", "/api/v1/student/sessions/ONE/questions");
        rejected.addHeader("X-Participant-Token", "another-header");
        rejected.setAttribute(JsonBodyBudgetFilter.PARTICIPANT_TOKEN, "actual-participant");
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertFalse(gate.preHandle(rejected, response, this));
        assertEquals(429, response.getStatus());
        MockHttpServletRequest legacy = new MockHttpServletRequest("POST", "/api/v1/student/sessions/ONE/questions");
        legacy.setAttribute(JsonBodyBudgetFilter.PARTICIPANT_TOKEN, "another-participant");
        complete(gate, legacy);
    }

    private QuotaCredentialResolver credentials() { return credentials(new SimpleMeterRegistry()); }
    private QuotaCredentialResolver credentials(SimpleMeterRegistry meters) {
        CredentialQuotaSubjectApi provider = new CredentialQuotaSubjectApi() {
            @Override public String headerName() { return "X-Participant-Token"; }
            @Override public boolean supports(String path) { return true; }
            @Override public Optional<String> findSubject(String path, String token) {
                return token.startsWith("garbage") ? Optional.empty() : Optional.of("person:" + token);
            }
        };
        return new QuotaCredentialResolver(List.of(provider), Clock.systemUTC(), meters, 120_000, 4);
    }

    private void complete(RequestAdmissionInterceptor gate, MockHttpServletRequest request) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertTrue(gate.preHandle(request, response, this));
        gate.afterCompletion(request, response, this, null);
    }

    private MockHttpServletRequest request(String participant, String path) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        request.setRemoteAddr("10.0.0.1");
        request.addHeader("X-Participant-Token", participant);
        return request;
    }
}
