package ru.university.assistant.live.internal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AccountStateApi;
import ru.university.assistant.iam.api.TokenAuthenticationApi;
import ru.university.assistant.live.api.LiveSession;
import ru.university.assistant.live.api.StudentSessionSnapshot;
import ru.university.assistant.org.api.CourseAccessApi;
import ru.university.assistant.shared.api.ServiceAuthentication;

/** Gateway RPCs carry fresh authorization; a cached snapshot is never a permission. */
@RestController
class RealtimeServiceController {
    private final ServiceAuthentication serviceAuth;
    private final StudentWebSessionService students;
    private final LiveSessionRepository sessions;
    private final LiveSessionService live;
    private final AccountStateApi accounts;
    private final TokenAuthenticationApi tokens;
    private final CourseAccessApi access;
    private final com.fasterxml.jackson.databind.ObjectMapper json;

    RealtimeServiceController(ServiceAuthentication serviceAuth, StudentWebSessionService students,
            LiveSessionRepository sessions, LiveSessionService live, AccountStateApi accounts,
            TokenAuthenticationApi tokens, CourseAccessApi access, com.fasterxml.jackson.databind.ObjectMapper json) {
        this.serviceAuth = serviceAuth; this.students = students; this.sessions = sessions;
        this.live = live; this.accounts = accounts; this.tokens = tokens; this.access = access;
        this.json = json;
    }

    @PostMapping("/internal/v1/realtime/student-grant")
    Map<String, Object> studentGrant(@RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody StudentGrantRequest request) {
        serviceAuth.require("realtime", key);
        Instant expires = Instant.now().plusSeconds(5);
        UUID person = students.participantPersonId(request.joinCode(), request.participantToken());
        var state = accounts.find(person).orElseThrow(() -> denied());
        if (!students.canReceive(request.joinCode(), person)) throw denied();
        var snapshot = students.snapshotForViewer(request.joinCode(), person);
        return Map.of("personId", person, "authVersion", state.version(), "expiresAt", expires,
                "checkedAt", expires.minusSeconds(5), "sessionId", snapshot.sessionId(), "snapshot", bounded(snapshot));
    }

    @PostMapping("/internal/v1/realtime/student-batch")
    Map<String, Object> studentBatch(@RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody StudentBatchRequest request) {
        serviceAuth.require("realtime", key);
        Instant expires = Instant.now().plusSeconds(5);
        Set<UUID> ids = request.subjects().stream().map(Subject::personId).collect(Collectors.toSet());
        Map<UUID, Long> versions = accounts.enabledVersions(ids);
        Set<UUID> allowed = students.answerRecipients(request.joinCode(), ids);
        Set<UUID> valid = request.subjects().stream()
                .filter(subject -> allowed.contains(subject.personId())
                        && Long.valueOf(subject.authVersion()).equals(versions.get(subject.personId())))
                .map(Subject::personId).collect(Collectors.toSet());
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("expiresAt", expires); result.put("checkedAt", expires.minusSeconds(5));
        result.put("allowed", valid);
        Map<UUID, Overlay> overlays = new java.util.LinkedHashMap<>();
        Set<UUID> oversized = new java.util.HashSet<>();
        if (request.includeSnapshots()) {
            StudentSessionSnapshot shared = students.snapshot(request.joinCode());
            Object common = bounded(shared);
            result.put("shared", common);
            if (common == shared) students.snapshotsForViewers(request.joinCode(), valid)
                    .forEach((person, snapshot) -> {
                Overlay overlay = new Overlay(snapshot.activePoll(), snapshot.myVote(), snapshot.questionAnswers(),
                        snapshot.kicked(), snapshot.nameRequested(), snapshot.myQuestions(), snapshot.myTextAnswer(),
                        snapshot.questionPostingMuted());
                if (fits(overlay, 8192)) overlays.put(person, overlay); else oversized.add(person);
            });
        }
        result.put("overlays", overlays); result.put("oversized", oversized);
        return result;
    }

    @PostMapping("/internal/v1/realtime/public-snapshot")
    Object publicSnapshot(
            @RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody PublicRequest request) {
        serviceAuth.require("realtime", key);
        return bounded(students.snapshot(request.joinCode()));
    }

    @PostMapping("/internal/v1/realtime/presenter-grant")
    Map<String, Object> presenterGrant(@RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody PresenterRequest request) {
        serviceAuth.require("realtime", key);
        Instant expires = Instant.now().plusSeconds(5);
        var user = tokens.parseAccessToken(request.accessToken()).orElseThrow(() -> denied());
        LiveSession session = live.requireSession(request.sessionId());
        access.requireManage(user, session.courseId());
        return Map.of("personId", user.id(), "session", session, "expiresAt", expires,
                "checkedAt", expires.minusSeconds(5));
    }

    @PostMapping("/internal/v1/realtime/presenter-presence")
    @org.springframework.web.bind.annotation.ResponseStatus(HttpStatus.NO_CONTENT)
    void presence(@RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody SessionRequest request) {
        serviceAuth.require("realtime", key);
        // Called only for a gateway that still holds at least one freshly authorized presenter.
        sessions.touchPresenter(request.sessionId());
    }

    @PostMapping("/internal/v1/realtime/health")
    Map<String, String> health(@RequestHeader(value = "X-Service-Key", required = false) String key) {
        serviceAuth.require("realtime", key);
        return Map.of("status", "UP");
    }

    private static ResponseStatusException denied() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "Realtime access revoked");
    }

    private Object bounded(StudentSessionSnapshot snapshot) {
        if (fits(snapshot, 8192)) return snapshot;
        return Map.of("sessionId", snapshot.sessionId(), "version", snapshot.version(),
                "status", snapshot.status(), "gatewayInvalidation", true);
    }

    private boolean fits(Object value, int limit) {
        java.io.OutputStream counter = new java.io.OutputStream() {
            int count;
            @Override public void write(int b) throws java.io.IOException { charge(1); }
            @Override public void write(byte[] b, int off, int len) throws java.io.IOException { charge(len); }
            private void charge(int length) throws java.io.IOException {
                if (length > limit - count) throw new TooLarge();
                count += length;
            }
        };
        try { json.writeValue(counter, value); return true; }
        catch (java.io.IOException failure) {
            for (Throwable cause = failure; cause != null; cause = cause.getCause())
                if (cause instanceof TooLarge) return false;
            throw new IllegalStateException("Cannot encode realtime snapshot", failure);
        }
    }

    private static final class TooLarge extends java.io.IOException {}
    private record Overlay(ru.university.assistant.interaction.api.ActivePollView activePoll,
            Integer myVote, List<ru.university.assistant.qa.api.StudentQuestionAnswer> questionAnswers,
            boolean kicked, boolean nameRequested, List<ru.university.assistant.qa.api.StudentQuestion> myQuestions,
            String myTextAnswer, boolean questionPostingMuted) {}

    record StudentGrantRequest(@NotBlank @Size(max = 16) String joinCode,
            @NotBlank @Size(max = 256) String participantToken) {}
    record Subject(@NotNull UUID personId, long authVersion) {}
    record StudentBatchRequest(@NotBlank @Size(max = 16) String joinCode,
            @NotNull @Size(max = 1000) List<@Valid Subject> subjects, boolean includeSnapshots) {}
    record PublicRequest(@NotBlank @Size(max = 16) String joinCode) {}
    record PresenterRequest(@NotNull UUID sessionId, @NotBlank @Size(max = 8192) String accessToken) {}
    record SessionRequest(@NotNull UUID sessionId) {}
}
