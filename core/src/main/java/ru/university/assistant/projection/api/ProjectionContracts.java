package ru.university.assistant.projection.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Wire protocol v1. Separate public-view and narrowly scoped lecture-control grants. */
public final class ProjectionContracts {
    public static final String VERSION_PATTERN = "[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}";

    private ProjectionContracts() {}

    public enum Platform { WINDOWS_X64, WINDOWS_ARM64, MACOS_X64, MACOS_ARM64 }
    public enum DeviceStatus { IDLE, TESTING, SHOWING, PAUSED, ERROR }
    public enum CommandType {
        PREPARE_DISPLAYS, IDENTIFY_SCREENS, RESTORE_DISPLAYS, FOCUS_PRIVATE_REMOTE,
        TEST_TARGET, START_PUBLIC_PROJECTION, STOP_PROJECTION, CHECK_UPDATE
    }
    public enum CommandResult { COMPLETED, FAILED }

    public record Settings(boolean agentAllowed, String minimumVersion, String latestVersion,
            long revision, Instant updatedAt, List<Installer> installers, List<Device> devices) {}

    public record Installer(Platform platform, String version, String minimumOsVersion,
            String url, String sha256, long size) {}

    public record SignedReleaseEnvelope(
            @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{1,64}") String keyId,
            @NotBlank @Size(max = 32768) @Pattern(regexp = "[A-Za-z0-9+/]+={0,2}") String payload,
            @NotBlank @Pattern(regexp = "[A-Za-z0-9+/]{86}==") String signature) {}

    public record PolicyUpdate(@NotNull Boolean agentAllowed,
            @NotBlank @Pattern(regexp = VERSION_PATTERN) String minimumVersion,
            @Min(0) long expectedRevision) {}

    public record AppearanceUpdate(@NotNull @Pattern(regexp = "light|dark") String theme) {}

    public record Pairing(UUID id, String pairingCode, Instant expiresAt) {}

    public record PairRequest(@NotBlank @Pattern(regexp = "[A-HJ-NP-Z2-9]{12}") String pairingCode,
            @NotBlank @Size(max = 80) String name, @NotNull Platform platform,
            @NotBlank @Pattern(regexp = VERSION_PATTERN) String version,
            @NotBlank @Size(max = 80) String osVersion, @Min(1) @Max(1) int protocolVersion) {}

    public record PairedDevice(UUID deviceId, String deviceToken, int protocolVersion) {}

    public record Screen(@NotBlank @Size(max = 160) String id, @Size(max = 120) String label,
            @Min(1) @Max(32768) int width, @Min(1) @Max(32768) int height, boolean isPrimary) {}

    public record Device(UUID id, String name, Platform platform, String version, String osVersion,
            DeviceStatus status, Instant lastSeenAt, boolean connected, boolean revoked,
            boolean updateRequired, List<Screen> screens, String diagnosticCode, UUID activeSessionId) {}

    public record Ack(@NotNull UUID commandId, @NotNull CommandResult result,
            @Pattern(regexp = "[A-Z0-9_]{1,64}") String diagnosticCode) {}

    public record PollRequest(@NotBlank @Pattern(regexp = VERSION_PATTERN) String version,
            @Min(1) @Max(1) int protocolVersion, @NotNull DeviceStatus status,
            @NotNull @Size(max = 16) List<@Valid Screen> screens, @Valid Ack ack,
            @Pattern(regexp = "(?:[0-9]{1,5}(\\.[0-9]{1,5}){1,3})?") String osVersion) {}

    public record AgentPolicy(boolean allowed, String minimumVersion) {}

    public record CommandPayload(String joinCode, String targetScreenId, String testCode,
            String projectionViewToken, String controlToken, UUID courseId, UUID sessionId) {}

    public record Command(UUID id, CommandType type, Instant expiresAt, CommandPayload payload) {}

    public record PollResponse(int protocolVersion, int pollAfterMs, Instant leaseUntil, boolean mustStop,
            AgentPolicy policy, boolean updateRequired, SignedReleaseEnvelope release, List<Command> commands,
            String remoteTheme) {}

    public record CommandRequest(@NotNull UUID deviceId, @NotNull UUID requestId,
            @NotNull CommandType type, @Size(max = 160) String targetScreenId,
            boolean displayConfirmed, @Pattern(regexp = "[A-HJ-NP-Z2-9]{6}") String testCode) {}
}
