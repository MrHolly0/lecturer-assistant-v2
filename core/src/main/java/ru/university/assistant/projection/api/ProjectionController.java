package ru.university.assistant.projection.api;

import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.projection.api.ProjectionContracts.AppearanceUpdate;
import ru.university.assistant.projection.api.ProjectionContracts.Command;
import ru.university.assistant.projection.api.ProjectionContracts.CommandRequest;
import ru.university.assistant.projection.api.ProjectionContracts.Pairing;
import ru.university.assistant.projection.api.ProjectionContracts.PolicyUpdate;
import ru.university.assistant.projection.api.ProjectionContracts.Settings;
import ru.university.assistant.projection.internal.ProjectionService;

@RestController
public class ProjectionController {
    private final ProjectionService projection;

    public ProjectionController(ProjectionService projection) {
        this.projection = projection;
    }

    @GetMapping("/api/v1/projection/settings")
    public Settings settings(@AuthenticationPrincipal AuthenticatedUser user) {
        return projection.settings(user);
    }

    @PutMapping("/api/v1/admin/projection/policy")
    public Settings updatePolicy(@AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody PolicyUpdate request) {
        return projection.updatePolicy(user, request);
    }

    @PostMapping("/api/v1/projection/pairings")
    @ResponseStatus(HttpStatus.CREATED)
    public Pairing createPairing(@AuthenticationPrincipal AuthenticatedUser user) {
        return projection.createPairing(user);
    }

    @DeleteMapping("/api/v1/projection/devices/{deviceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID deviceId) {
        projection.revoke(user, deviceId);
    }

    @PutMapping("/api/v1/projection/devices/{deviceId}/appearance")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void appearance(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID deviceId,
            @Valid @RequestBody AppearanceUpdate request) {
        projection.appearance(user, deviceId, request);
    }

    @PostMapping("/api/v1/courses/{courseId}/sessions/{sessionId}/projection/commands")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Command command(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId,
            @PathVariable UUID sessionId, @Valid @RequestBody CommandRequest request) {
        return projection.command(user, courseId, sessionId, request);
    }
}
