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

    RealtimeServiceController(
            ServiceAuthentication serviceAuth,
            StudentWebSessionService students,
            LiveSessionRepository sessions,
            LiveSessionService live,
            AccountStateApi accounts,
            TokenAuthenticationApi tokens,
            CourseAccessApi access,
            com.fasterxml.jackson.databind.ObjectMapper json) {
        this.serviceAuth = serviceAuth;
        this.students = students;
        this.sessions = sessions;
        this.live = live;
        this.accounts = accounts;
        this.tokens = tokens;
        this.access = access;
        this.json = json;
    }

    @PostMapping("/internal/v1/realtime/student-grant")
    Map<String, Object> studentGrant(
            @RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody StudentGrantRequest request) {
        serviceAuth.require("realtime", key);
        Instant expires = Instant.now().plusSeconds(5);
        UUID person = students.participantPersonId(request.joinCode(), request.participantToken());
        var state = accounts.find(person).orElseThrow(() -> denied());
        if (!students.canReceive(request.joinCode(), person)) throw denied();
        var snapshot =
                request.compact()
                        ? students.compact(request.joinCode(), person)
                        : students.snapshotForViewer(request.joinCode(), person);
        return Map.of(
                "personId",
                person,
                "authVersion",
                state.version(),
                "expiresAt",
                expires,
                "checkedAt",
                expires.minusSeconds(5),
                "sessionId",
                snapshot.sessionId(),
                "snapshot",
                bounded(snapshot, historyRef(request.joinCode(), person), request.compact()));
    }

    @PostMapping("/internal/v1/realtime/student-batch")
    Map<String, Object> studentBatch(
            @RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody StudentBatchRequest request) {
        serviceAuth.require("realtime", key);
        Instant expires = Instant.now().plusSeconds(5);
        Set<UUID> ids =
                request.subjects().stream().map(Subject::personId).collect(Collectors.toSet());
        Map<UUID, Long> versions = accounts.enabledVersions(ids);
        Set<UUID> allowed = students.answerRecipients(request.joinCode(), ids);
        Set<UUID> valid =
                request.subjects().stream()
                        .filter(
                                subject ->
                                        allowed.contains(subject.personId())
                                                && Long.valueOf(subject.authVersion())
                                                        .equals(versions.get(subject.personId())))
                        .map(Subject::personId)
                        .collect(Collectors.toSet());
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("expiresAt", expires);
        result.put("checkedAt", expires.minusSeconds(5));
        result.put("allowed", valid);
        Map<UUID, Object> overlays = new java.util.LinkedHashMap<>();
        Set<UUID> oversized = new java.util.HashSet<>();
        if (request.includeSnapshots()) {
            var revisions = students.historyRevisions(request.joinCode(), valid);
            String publicRevision = Long.toString(revisions.getOrDefault(new UUID(0, 0), 0L));
            StudentSessionSnapshot shared =
                    request.compact()
                            ? students.compact(request.joinCode(), null)
                            : students.snapshot(request.joinCode());
            Object common = bounded(shared, publicRevision + ".0", request.compact());
            if (request.compact()
                    && common instanceof com.fasterxml.jackson.databind.node.ObjectNode node) {
                node.remove(
                        List.of(
                                "activePoll",
                                "myVote",
                                "questionAnswers",
                                "kicked",
                                "nameRequested",
                                "myQuestions",
                                "myTextAnswer",
                                "questionPostingMuted",
                                "historyRevision"));
                result.put("splitSnapshot", true);
            }
            result.put("shared", common);
            (request.compact()
                            ? students.compactForViewers(request.joinCode(), valid)
                            : students.snapshotsForViewers(request.joinCode(), valid))
                    .forEach(
                            (person, snapshot) -> {
                                var overlay =
                                        json.valueToTree(
                                                new Overlay(
                                                        snapshot.activePoll(),
                                                        snapshot.myVote(),
                                                        request.compact()
                                                                ? List.of()
                                                                : snapshot.questionAnswers(),
                                                        snapshot.kicked(),
                                                        snapshot.nameRequested(),
                                                        request.compact()
                                                                ? List.of()
                                                                : snapshot.myQuestions(),
                                                        snapshot.myTextAnswer(),
                                                        snapshot.questionPostingMuted()));
                                ((com.fasterxml.jackson.databind.node.ObjectNode) overlay)
                                        .put(
                                                "historyRevision",
                                                publicRevision
                                                        + "."
                                                        + revisions.getOrDefault(person, 0L));
                                if (fits(overlay, 8192)) overlays.put(person, overlay);
                                else {
                                    oversized.add(person);
                                    overlays.put(
                                            person,
                                            Map.of(
                                                    "privateStateHash",
                                                    stateHash(overlay),
                                                    "historyRevision",
                                                    publicRevision
                                                            + "."
                                                            + revisions.getOrDefault(person, 0L)));
                                }
                            });
        }
        result.put("overlays", overlays);
        result.put("oversized", oversized);
        return result;
    }

    @PostMapping("/internal/v1/realtime/public-snapshot")
    Object publicSnapshot(
            @RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody PublicRequest request) {
        serviceAuth.require("realtime", key);
        return bounded(
                request.compact()
                        ? students.compact(request.joinCode(), null)
                        : students.snapshot(request.joinCode()),
                historyRef(request.joinCode(), null),
                request.compact());
    }

    @PostMapping("/internal/v1/realtime/presenter-grant")
    Map<String, Object> presenterGrant(
            @RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody PresenterRequest request) {
        serviceAuth.require("realtime", key);
        Instant expires = Instant.now().plusSeconds(5);
        var user = tokens.parseAccessToken(request.accessToken()).orElseThrow(() -> denied());
        LiveSession session = live.requireSession(request.sessionId());
        access.requireManage(user, session.courseId());
        return Map.of(
                "personId",
                user.id(),
                "session",
                session,
                "expiresAt",
                expires,
                "checkedAt",
                expires.minusSeconds(5));
    }

    @PostMapping("/internal/v1/realtime/presenter-presence")
    @org.springframework.web.bind.annotation.ResponseStatus(HttpStatus.NO_CONTENT)
    void presence(
            @RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody SessionRequest request) {
        serviceAuth.require("realtime", key);
        // Called only for a gateway that still holds at least one freshly authorized presenter.
        sessions.touchPresenter(request.sessionId());
    }

    @PostMapping("/internal/v1/realtime/health")
    Map<String, String> health(
            @RequestHeader(value = "X-Service-Key", required = false) String key) {
        serviceAuth.require("realtime", key);
        return Map.of("status", "UP");
    }

    private static ResponseStatusException denied() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "Realtime access revoked");
    }

    private String historyRef(String code, UUID person) {
        var revisions = students.historyRevisions(code, person == null ? Set.of() : Set.of(person));
        return revisions.getOrDefault(new UUID(0, 0), 0L)
                + "."
                + (person == null ? 0L : revisions.getOrDefault(person, 0L));
    }

    private Object bounded(StudentSessionSnapshot snapshot, String history, boolean compactMode) {
        com.fasterxml.jackson.databind.node.ObjectNode compact = json.valueToTree(snapshot);
        if (compactMode) {
            compact.put("deliveryMode", "compact");
            compact.put("historyRevision", history);
            compact.remove(List.of("myQuestions", "questionAnswers"));
        }
        if (fits(compact, 8192)) return compact;
        return Map.of(
                "sessionId",
                snapshot.sessionId(),
                "version",
                snapshot.version(),
                "status",
                snapshot.status(),
                "gatewayInvalidation",
                true,
                "commonStateHash",
                stateHash(compact));
    }

    private String stateHash(Object value) {
        try {
            return java.util.HexFormat.of()
                    .formatHex(
                            java.security.MessageDigest.getInstance("SHA-256")
                                    .digest(json.writeValueAsBytes(value)));
        } catch (java.io.IOException | java.security.NoSuchAlgorithmException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private boolean fits(Object value, int limit) {
        java.io.OutputStream counter =
                new java.io.OutputStream() {
                    int count;

                    @Override
                    public void write(int b) throws java.io.IOException {
                        charge(1);
                    }

                    @Override
                    public void write(byte[] b, int off, int len) throws java.io.IOException {
                        charge(len);
                    }

                    private void charge(int length) throws java.io.IOException {
                        if (length > limit - count) throw new TooLarge();
                        count += length;
                    }
                };
        try {
            json.writeValue(counter, value);
            return true;
        } catch (java.io.IOException failure) {
            for (Throwable cause = failure; cause != null; cause = cause.getCause())
                if (cause instanceof TooLarge) return false;
            throw new IllegalStateException("Cannot encode realtime snapshot", failure);
        }
    }

    private static final class TooLarge extends java.io.IOException {}

    private record Overlay(
            ru.university.assistant.interaction.api.ActivePollView activePoll,
            Integer myVote,
            List<ru.university.assistant.qa.api.StudentQuestionAnswer> questionAnswers,
            boolean kicked,
            boolean nameRequested,
            List<ru.university.assistant.qa.api.StudentQuestion> myQuestions,
            String myTextAnswer,
            boolean questionPostingMuted) {}

    record StudentGrantRequest(
            @NotBlank @Size(max = 16) String joinCode,
            @NotBlank @Size(max = 256) String participantToken,
            boolean compact) {}

    record Subject(@NotNull UUID personId, long authVersion) {}

    record StudentBatchRequest(
            @NotBlank @Size(max = 16) String joinCode,
            @NotNull @Size(max = 1000) List<@Valid Subject> subjects,
            boolean includeSnapshots,
            boolean compact) {}

    record PublicRequest(@NotBlank @Size(max = 16) String joinCode, boolean compact) {}

    record PresenterRequest(
            @NotNull UUID sessionId, @NotBlank @Size(max = 8192) String accessToken) {}

    record SessionRequest(@NotNull UUID sessionId) {}
}
