package ru.university.assistant.projection.api;

import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.MediaViewingAccessApi;
import ru.university.assistant.projection.api.ShareContracts.Description;
import ru.university.assistant.projection.api.ShareContracts.Start;
import ru.university.assistant.projection.api.ShareContracts.Status;
import ru.university.assistant.projection.api.ShareContracts.Viewer;
import ru.university.assistant.projection.internal.ShareService;
import ru.university.assistant.projection.internal.ProjectionService;

@RestController
public class ShareController {
    private static final String STAFF = "/api/v1/courses/{courseId}/sessions/{sessionId}/screen-share";
    private static final String VIEWER = "/api/v1/student/sessions/{joinCode}/screen-share/viewers/{viewerId}";
    private static final String PROJECTION_VIEWER =
            "/api/v1/projection/agent/view/sessions/{joinCode}/screen-share/viewers/{viewerId}";
    private final ShareService shares;
    private final MediaViewingAccessApi viewing;
    private final ProjectionService projection;

    public ShareController(ShareService shares, MediaViewingAccessApi viewing, ProjectionService projection) {
        this.shares = shares;
        this.viewing = viewing;
        this.projection = projection;
    }

    @PostMapping(STAFF)
    public Status start(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId, @PathVariable UUID sessionId, @Valid @RequestBody Start request) {
        return shares.start(user, courseId, sessionId, request.sourceName());
    }

    @GetMapping(STAFF + "/{shareId}")
    public Status poll(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId,
            @PathVariable UUID sessionId, @PathVariable UUID shareId) {
        return shares.poll(user, courseId, sessionId, shareId);
    }

    @PutMapping(STAFF + "/{shareId}/viewers/{viewerId}")
    public ResponseEntity<Void> offer(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId,
            @PathVariable UUID sessionId, @PathVariable UUID shareId, @PathVariable UUID viewerId,
            @Valid @RequestBody Description request) {
        shares.offer(user, courseId, sessionId, shareId, viewerId, request.sdp());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping(STAFF + "/{shareId}")
    public ResponseEntity<Void> stop(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID courseId,
            @PathVariable UUID sessionId, @PathVariable UUID shareId) {
        shares.stop(user, courseId, sessionId, shareId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping(value = STAFF + "/{shareId}/frame", consumes = MediaType.IMAGE_JPEG_VALUE)
    public ResponseEntity<Void> uploadFrame(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId, @PathVariable UUID sessionId, @PathVariable UUID shareId,
            HttpServletRequest request) throws IOException {
        int maximum = 256 * 1024;
        if (request.getContentLengthLong() > maximum) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Кадр больше 256 КБ");
        }
        // Bound the stream before allocating; this also covers a missing or dishonest Content-Length.
        byte[] bytes = request.getInputStream().readNBytes(maximum + 1);
        if (bytes.length > maximum) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Кадр больше 256 КБ");
        }
        shares.uploadFrame(user, courseId, sessionId, shareId, bytes);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @GetMapping(VIEWER)
    public ResponseEntity<Viewer> viewer(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable String joinCode, @PathVariable UUID viewerId,
            @RequestHeader(value = "X-Participant-Token", required = false) String participantToken) {
        Viewer result = shares.view(viewing.requireViewer(joinCode, user, participantToken), viewerId);
        return result == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(result);
    }

    @PutMapping(VIEWER + "/{shareId}")
    public ResponseEntity<Void> answer(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable String joinCode, @PathVariable UUID viewerId, @PathVariable UUID shareId,
            @RequestHeader(value = "X-Participant-Token", required = false) String participantToken,
            @Valid @RequestBody Description request) {
        shares.answer(viewing.requireViewer(joinCode, user, participantToken), shareId, viewerId, request.sdp());
        return ResponseEntity.noContent().build();
    }

    @GetMapping(value = VIEWER + "/frame", produces = MediaType.IMAGE_JPEG_VALUE)
    public ResponseEntity<byte[]> frame(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable String joinCode, @PathVariable UUID viewerId,
            @RequestHeader(value = "X-Participant-Token", required = false) String participantToken) {
        return frameResponse(shares.frame(viewing.requireViewer(joinCode, user, participantToken), viewerId));
    }

    @GetMapping(PROJECTION_VIEWER)
    public ResponseEntity<Viewer> projectionViewer(@PathVariable String joinCode, @PathVariable UUID viewerId,
            @RequestHeader(value = "X-Projection-View-Token", required = false) String token) {
        Viewer result = shares.view(projection.requireProjectionViewer(joinCode, token), viewerId);
        return result == null ? ResponseEntity.noContent().build()
                : ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore()).body(result);
    }

    @PutMapping(PROJECTION_VIEWER + "/{shareId}")
    public ResponseEntity<Void> projectionAnswer(@PathVariable String joinCode, @PathVariable UUID viewerId,
            @PathVariable UUID shareId,
            @RequestHeader(value = "X-Projection-View-Token", required = false) String token,
            @Valid @RequestBody Description request) {
        shares.answer(projection.requireProjectionViewer(joinCode, token), shareId, viewerId, request.sdp());
        return ResponseEntity.noContent().build();
    }

    @GetMapping(value = PROJECTION_VIEWER + "/frame", produces = MediaType.IMAGE_JPEG_VALUE)
    public ResponseEntity<byte[]> projectionFrame(@PathVariable String joinCode, @PathVariable UUID viewerId,
            @RequestHeader(value = "X-Projection-View-Token", required = false) String token) {
        return frameResponse(shares.frame(projection.requireProjectionViewer(joinCode, token), viewerId));
    }

    private ResponseEntity<byte[]> frameResponse(byte[] bytes) {
        return bytes == null ? ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
                : ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_JPEG)
                        .header("X-Content-Type-Options", "nosniff").body(bytes);
    }
}
