package ru.university.assistant.installation.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.installation.internal.InstallationUpdates;
import ru.university.assistant.installation.internal.InstallationUpdates.Assignment;
import ru.university.assistant.installation.internal.InstallationUpdates.Job;
import ru.university.assistant.installation.internal.InstallationUpdates.SignedCatalog;

@RestController
public class InstallationController {
    private final InstallationUpdates updates;
    private final String operatorKey;

    InstallationController(InstallationUpdates updates,
            @Value("${app.installation.operator-key:}") String operatorKey) {
        this.updates = updates;
        this.operatorKey = operatorKey;
    }

    @GetMapping("/api/v1/admin/installation")
    public InstallationUpdates.Status status(@AuthenticationPrincipal AuthenticatedUser actor) {
        return updates.status(actor);
    }

    @PostMapping("/api/v1/admin/installation/jobs")
    public Job request(@AuthenticationPrincipal AuthenticatedUser actor,
            @RequestHeader(name = "Idempotency-Key", required = false) String key,
            @Valid @RequestBody UpdateRequest request) {
        return updates.request(actor, request.releaseId(), key);
    }

    @PostMapping("/api/v1/admin/installation/jobs/{id}/cancel")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancel(@AuthenticationPrincipal AuthenticatedUser actor, @PathVariable UUID id) {
        updates.cancel(actor, id);
    }

    @PostMapping("/api/v1/admin/installation/jobs/{id}/acknowledge")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void acknowledge(@AuthenticationPrincipal AuthenticatedUser actor, @PathVariable UUID id) {
        updates.acknowledge(actor, id);
    }

    @PostMapping("/internal/v1/installation/catalog")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void catalog(@RequestHeader(name = "X-Installation-Key", required = false) String key,
            @Valid @RequestBody CatalogRequest request) {
        authenticate(key);
        updates.sync(request.kind(), new SignedCatalog(request.payload(), request.signature()));
    }

    @PostMapping("/internal/v1/installation/claim")
    public Assignment claim(@RequestHeader(name = "X-Installation-Key", required = false) String key,
            @Valid @RequestBody ClaimRequest request) {
        authenticate(key);
        return updates.claim(request.owner());
    }

    @PostMapping("/internal/v1/installation/jobs/{id}/prepare")
    public Job prepare(@RequestHeader(name = "X-Installation-Key", required = false) String key,
            @PathVariable UUID id, @Valid @RequestBody LeaseRequest request) {
        authenticate(key);
        return updates.prepare(id, request.owner(), request.fence());
    }

    @PostMapping("/internal/v1/installation/jobs/{id}/heartbeat")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void heartbeat(@RequestHeader(name = "X-Installation-Key", required = false) String key,
            @PathVariable UUID id, @Valid @RequestBody LeaseRequest request) {
        authenticate(key);
        updates.heartbeat(id, request.owner(), request.fence());
    }

    @PostMapping("/internal/v1/installation/jobs/{id}/progress")
    public Job progress(@RequestHeader(name = "X-Installation-Key", required = false) String key,
            @PathVariable UUID id, @Valid @RequestBody ProgressRequest request) {
        authenticate(key);
        return updates.progress(id, request.owner(), request.fence(), request.stage(), request.summary());
    }

    private void authenticate(String presented) {
        if (operatorKey.length() < 32 || operatorKey.startsWith("REPLACE") || presented == null
                || !MessageDigest.isEqual(
                operatorKey.getBytes(StandardCharsets.UTF_8), presented.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid installation credential");
        }
    }
    public record UpdateRequest(@NotBlank @Size(max = 80) String releaseId) {}
    public record ClaimRequest(@NotNull UUID owner) {}
    public record CatalogRequest(@NotBlank @Size(max = 16) String kind,
            @NotBlank @Size(max = 262144) String payload, @NotBlank @Size(max = 256) String signature) {}
    public record LeaseRequest(@NotNull UUID owner, long fence) {}
    public record ProgressRequest(@NotNull UUID owner, long fence,
            @NotBlank @Size(max = 32) String stage, @Size(max = 500) String summary) {}
}
