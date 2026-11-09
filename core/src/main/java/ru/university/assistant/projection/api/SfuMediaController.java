package ru.university.assistant.projection.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.MediaViewingAccessApi;
import ru.university.assistant.projection.internal.ProjectionService;
import ru.university.assistant.projection.internal.SfuMediaService;
import ru.university.assistant.projection.internal.SfuTicketClient;
import ru.university.assistant.shared.api.ServiceAuthentication;

@RestController
@ConditionalOnProperty(name = "app.media.provider", havingValue = "sfu")
class SfuMediaController {
    private static final String STAFF = "/api/v1/courses/{course}/sessions/{session}/sfu-share";
    private final SfuMediaService media;
    private final SfuTicketClient tickets;
    private final MediaViewingAccessApi viewers;
    private final ProjectionService projection;
    private final ServiceAuthentication authentication;
    private final ru.university.assistant.shared.api.CommandIdempotency idempotency;

    SfuMediaController(SfuMediaService media, SfuTicketClient tickets, MediaViewingAccessApi viewers,
            ProjectionService projection, ServiceAuthentication authentication,
            ru.university.assistant.shared.api.CommandIdempotency idempotency) {
        this.media = media; this.tickets = tickets; this.viewers = viewers;
        this.projection = projection; this.authentication = authentication;
        this.idempotency = idempotency;
    }

    @PostMapping(STAFF)
    Object start(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID course,
            @PathVariable UUID session, @Valid @RequestBody ShareContracts.Start request,
            @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        media.authorizeManagement(user, course, session);
        return idempotency.execute(user.id(), "sfu-start:" + course + ":" + session, key,
                idempotency.hash(request), Map.class, () -> media.start(user, course, session, request.sourceName()));
    }

    @GetMapping(STAFF + "/{id}")
    Object poll(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID course,
            @PathVariable UUID session, @PathVariable UUID id) { return media.poll(user, course, session, id); }

    @DeleteMapping(STAFF + "/{id}")
    ResponseEntity<Void> stop(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID course,
            @PathVariable UUID session, @PathVariable UUID id) {
        media.stop(user, course, session, id); return ResponseEntity.noContent().build();
    }

    @PostMapping(STAFF + "/{id}/ticket")
    Object publisherTicket(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID course,
            @PathVariable UUID session, @PathVariable UUID id) {
        return tickets.ticket(media.publisherGrant(user, course, session, id));
    }

    @PostMapping("/api/v1/student/sessions/{code}/sfu-share/{viewer}")
    ResponseEntity<?> viewerTicket(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable String code, @PathVariable UUID viewer,
            @RequestHeader(value = "X-Participant-Token", required = false) String token) {
        return viewerResponse(media.viewerGrant(viewers.requireViewer(code, user, token), viewer, false));
    }

    @PostMapping("/api/v1/projection/agent/view/sessions/{code}/sfu-share/{viewer}")
    ResponseEntity<?> projectorTicket(@PathVariable String code, @PathVariable UUID viewer,
            @RequestHeader("X-Projection-View-Token") String token) {
        return viewerResponse(media.viewerGrant(projection.requireProjectionViewer(code, token), viewer, true));
    }

    private ResponseEntity<?> viewerResponse(Map<String, Object> status) {
        if (status == null) return ResponseEntity.noContent().build();
        var response = new java.util.LinkedHashMap<>(status);
        Object grant = response.remove("grantId");
        if (grant != null) response.put("ticket", tickets.ticket((UUID) grant));
        return ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore()).body(response);
    }

    @PostMapping("/internal/v1/media/authorize")
    Object authorize(@RequestHeader(value = "X-Service-Key", required = false) String key,
            @Valid @RequestBody AuthorizationRequest request) {
        authentication.require("media", key);
        return media.authorize(request.grants(), request.rooms());
    }

    record AuthorizationRequest(@NotNull @Size(max = 1000) List<@NotNull UUID> grants,
            @NotNull @Size(max = 1000) List<@NotNull UUID> rooms) {}
}
