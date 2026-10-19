package ru.university.assistant.projection.api;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import ru.university.assistant.iam.api.AuthenticatedUser;
import ru.university.assistant.live.api.MediaViewingAccessApi;
import ru.university.assistant.projection.internal.ProjectionService;
import ru.university.assistant.projection.internal.ShareVideoStore;

/** Authenticated encoded-video relay; binary bodies are bounded before allocation. */
@RestController
public class ShareVideoController {
    private static final String STAFF =
            "/api/v1/courses/{courseId}/sessions/{sessionId}/screen-share/{shareId}/video/{epoch}";
    private static final String VIEWER =
            "/api/v1/student/sessions/{joinCode}/screen-share/viewers/{viewerId}/video";
    private static final String PROJECTION =
            "/api/v1/projection/agent/view/sessions/{joinCode}/screen-share/viewers/{viewerId}/video";
    private final ShareVideoStore videos;
    private final MediaViewingAccessApi viewing;
    private final ProjectionService projection;

    public ShareVideoController(ShareVideoStore videos, MediaViewingAccessApi viewing, ProjectionService projection) {
        this.videos = videos; this.viewing = viewing; this.projection = projection;
    }

    @PutMapping(value = STAFF + "/init", consumes = "video/mp4")
    public ResponseEntity<Void> init(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId, @PathVariable UUID sessionId, @PathVariable UUID shareId,
            @PathVariable UUID epoch, @RequestParam String codec, HttpServletRequest request) throws IOException {
        videos.authorizePublisher(user, courseId, sessionId, shareId);
        videos.init(user, courseId, sessionId, shareId, epoch, codec, bounded(request, ShareVideoStore.MAX_INIT));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PutMapping(value = STAFF + "/segments/{sequence}", consumes = "video/mp4")
    public ResponseEntity<Void> segment(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID courseId, @PathVariable UUID sessionId, @PathVariable UUID shareId,
            @PathVariable UUID epoch, @PathVariable long sequence, HttpServletRequest request) throws IOException {
        videos.authorizePublisher(user, courseId, sessionId, shareId);
        videos.segment(user, courseId, sessionId, shareId, epoch, sequence,
                bounded(request, ShareVideoStore.MAX_SEGMENT));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @GetMapping(VIEWER)
    public ResponseEntity<ShareVideoMetadata> metadata(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable String joinCode, @PathVariable UUID viewerId,
            @RequestHeader(value = "X-Participant-Token", required = false) String token) {
        return metadataResponse(videos.metadata(viewing.requireViewer(joinCode, user, token), viewerId));
    }

    @GetMapping(value = VIEWER + "/{epoch}/init", produces = "video/mp4")
    public ResponseEntity<byte[]> init(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable String joinCode, @PathVariable UUID viewerId, @PathVariable UUID epoch,
            @RequestHeader(value = "X-Participant-Token", required = false) String token) {
        return binary(videos.initialization(viewing.requireViewer(joinCode, user, token), viewerId, epoch));
    }

    @GetMapping(value = VIEWER + "/{epoch}/segments/{sequence}", produces = "video/mp4")
    public ResponseEntity<byte[]> segment(@AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable String joinCode, @PathVariable UUID viewerId, @PathVariable UUID epoch,
            @PathVariable long sequence,
            @RequestHeader(value = "X-Participant-Token", required = false) String token) {
        return binary(videos.fragment(viewing.requireViewer(joinCode, user, token), viewerId, epoch, sequence));
    }

    @GetMapping(PROJECTION)
    public ResponseEntity<ShareVideoMetadata> projectionMetadata(@PathVariable String joinCode,
            @PathVariable UUID viewerId,
            @RequestHeader(value = "X-Projection-View-Token", required = false) String token) {
        return metadataResponse(videos.metadata(projection.requireProjectionViewer(joinCode, token), viewerId));
    }

    @GetMapping(value = PROJECTION + "/{epoch}/init", produces = "video/mp4")
    public ResponseEntity<byte[]> projectionInit(@PathVariable String joinCode, @PathVariable UUID viewerId,
            @PathVariable UUID epoch,
            @RequestHeader(value = "X-Projection-View-Token", required = false) String token) {
        return binary(videos.initialization(projection.requireProjectionViewer(joinCode, token), viewerId, epoch));
    }

    @GetMapping(value = PROJECTION + "/{epoch}/segments/{sequence}", produces = "video/mp4")
    public ResponseEntity<byte[]> projectionSegment(@PathVariable String joinCode, @PathVariable UUID viewerId,
            @PathVariable UUID epoch, @PathVariable long sequence,
            @RequestHeader(value = "X-Projection-View-Token", required = false) String token) {
        return binary(videos.fragment(projection.requireProjectionViewer(joinCode, token), viewerId, epoch, sequence));
    }

    private byte[] bounded(HttpServletRequest request, int maximum) throws IOException {
        if (request.getContentLengthLong() > maximum) throw oversized();
        byte[] bytes = request.getInputStream().readNBytes(maximum + 1);
        if (bytes.length > maximum) throw oversized();
        return bytes;
    }
    private ResponseStatusException oversized() {
        return new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Видеосегмент слишком большой");
    }
    private ResponseEntity<ShareVideoMetadata> metadataResponse(ShareVideoMetadata metadata) {
        return metadata == null ? ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build()
                : ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(metadata);
    }
    private ResponseEntity<byte[]> binary(byte[] bytes) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("Content-Type", "video/mp4")
                .header("X-Content-Type-Options", "nosniff").body(bytes);
    }
}
