package ru.university.assistant.projection.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Signalling only: no frames, private questions, or staff tokens are relayed. */
public final class ShareContracts {
    private ShareContracts() {}
    public record IceServer(List<String> urls, String username, String credential) {}
    public record Start(@NotBlank @Size(max = 120) String sourceName) {}
    public record Description(@NotBlank @Size(max = 65536) String sdp) {}
    public record Peer(UUID id, String offer, String answer) {}
    public record Status(UUID id, String sourceName, Instant leaseUntil, boolean paused,
            List<Peer> peers, List<IceServer> iceServers) {}
    public record Viewer(UUID id, String offer, boolean paused, List<IceServer> iceServers) {}
}
