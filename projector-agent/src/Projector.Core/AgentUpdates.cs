using System.Text.Json;
namespace Lecturer.Projector;

public sealed record StagedUpdate(string EnvelopePath, string PackagePath, string Version, long Sequence = 0, string? EnvelopeDigest = null);
public sealed record AgentUpdateServices(TimeProvider Clock, Func<UpdateTrust> LoadTrust,
    Func<ReleaseManifest, string, CancellationToken, Task> Download, Action? BeforeCheckpointCommit = null);

/// <summary>Signature/download run away from the poll loop. Failed attempts retry with bounded monotonic backoff.</summary>
public sealed class AgentUpdates
{
    private readonly object gate = new();
    private readonly string? root;
    private readonly string platform;
    private readonly string runningVersion;
    private readonly Version osVersion;
    private readonly AgentUpdateServices services;
    private Task? downloading;
    private StagedUpdate? ready;
    private string? completedPayload;
    private string? retryPayload;
    private int failures;
    private long failedAt;
    private TimeSpan retryDelay;
    private bool handoffPending;
    private long handoffFailedAt;
    private bool handoffBackoff;
    public string? DiagnosticCode { get; private set; }
    public Task CurrentAttempt { get { lock (gate) return downloading ?? Task.CompletedTask; } }
    public AgentUpdates(string runningVersion, string? installRoot = null, string? targetPlatform = null,
        Version? targetOsVersion = null, AgentUpdateServices? services = null)
    {
        this.runningVersion = runningVersion;
        root = installRoot ?? Environment.GetEnvironmentVariable("LA_PROJECTOR_INSTALL_ROOT");
        this.services = services ?? new(TimeProvider.System, EmbeddedTrust.Load, UpdatePackage.Download);
        osVersion = targetOsVersion ?? Environment.OSVersion.Version;
        platform = targetPlatform ?? (OperatingSystem.IsWindows()
            ? (System.Runtime.InteropServices.RuntimeInformation.OSArchitecture == System.Runtime.InteropServices.Architecture.Arm64 ? "WINDOWS_ARM64" : "WINDOWS_X64")
            : (System.Runtime.InteropServices.RuntimeInformation.OSArchitecture == System.Runtime.InteropServices.Architecture.Arm64 ? "MACOS_ARM64" : "MACOS_X64"));
        LoadCommittedStage();
    }
    private bool InStaging(string path) => root is not null && Path.GetFullPath(path).StartsWith(Path.GetFullPath(Path.Combine(root, "staging")) + Path.DirectorySeparatorChar, StringComparison.Ordinal);
    private void LoadCommittedStage()
    {
        if (root is null) return;
        var file = Path.Combine(root, "staged-update.json");
        var checkpointFile = Path.Combine(root, "accepted-release.json");
        if (!File.Exists(file) || !File.Exists(checkpointFile) || new FileInfo(file).Length > 8192 || new FileInfo(checkpointFile).Length > 8192) return;
        try
        {
            var staged = JsonSerializer.Deserialize<StagedUpdate>(File.ReadAllBytes(file), Wire.Json);
            var checkpoint = JsonSerializer.Deserialize<UpdateCheckpoint>(File.ReadAllBytes(checkpointFile), Wire.Json);
            if (staged is null || checkpoint is null || staged.Sequence != checkpoint.Sequence || staged.Version != checkpoint.Version ||
                !Version.TryParse(staged.Version, out var next) || !Version.TryParse(runningVersion, out var running) || next <= running ||
                !InStaging(staged.EnvelopePath) || !InStaging(staged.PackagePath) || !File.Exists(staged.EnvelopePath) || !File.Exists(staged.PackagePath)) return;
            // Reverify at install; loading a descriptor alone never grants executable trust.
            ready = staged;
            if (staged.EnvelopeDigest == DisplaySafety.Fingerprint(File.ReadAllText(staged.EnvelopePath))) completedPayload = File.ReadAllText(staged.EnvelopePath);
        }
        catch (Exception ex) when (ex is JsonException or IOException or InvalidDataException) { DiagnosticCode = "BAD_STAGED_UPDATE_STATE"; }
    }
    public void Observe(JsonElement? release)
    {
        if (release is null || release.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined || root is null) return;
        var raw = release.Value.GetRawText(); if (raw.Length > 65_536) return;
        lock (gate)
        {
            if (downloading is { IsCompleted: false } || raw == completedPayload) return;
            if (raw == retryPayload && services.Clock.GetElapsedTime(failedAt, services.Clock.GetTimestamp()) < retryDelay) return;
            if (raw != retryPayload) failures = 0;
            downloading = Task.Run(() => Attempt(raw));
        }
    }
    private async Task Attempt(string raw)
    {
        try
        {
            var trust = services.LoadTrust();
            Directory.CreateDirectory(root!);
            var checkpointPath = Path.Combine(root!, "accepted-release.json");
            var checkpoint = File.Exists(checkpointPath)
                ? JsonSerializer.Deserialize<UpdateCheckpoint>(File.ReadAllBytes(checkpointPath), Wire.Json) ?? throw new InvalidDataException("BAD_CHECKPOINT")
                : new UpdateCheckpoint(0, runningVersion);
            var bytes = System.Text.Encoding.UTF8.GetBytes(raw);
            var manifest = ReleaseVerifier.Verify(bytes, trust, platform, osVersion, runningVersion, checkpoint, services.Clock.GetUtcNow());
            var staging = Path.Combine(root!, "staging"); Directory.CreateDirectory(staging);
            var package = Path.Combine(staging, manifest.Version + "-" + manifest.Sha256[..16] + ".zip");
            if (File.Exists(package))
            {
                try { using var existing = File.OpenRead(package); ReleaseVerifier.VerifyPackage(existing, manifest); }
                catch (InvalidDataException) { File.Delete(package); }
            }
            if (!File.Exists(package)) await services.Download(manifest, package, CancellationToken.None);
            using (var verified = File.OpenRead(package)) ReleaseVerifier.VerifyPackage(verified, manifest);
            var envelope = package + ".envelope.json";
            var envelopeTemporary = envelope + "." + Guid.NewGuid().ToString("N") + ".new";
            File.WriteAllBytes(envelopeTemporary, bytes); File.Move(envelopeTemporary, envelope, true);
            var staged = new StagedUpdate(envelope, package, manifest.Version, manifest.Sequence, DisplaySafety.Fingerprint(raw));
            // Descriptor first, replay checkpoint last. A pre-checkpoint failure can retry the same signed envelope.
            UpdateTransaction.WriteAtomic(Path.Combine(root!, "staged-update.json"), staged);
            services.BeforeCheckpointCommit?.Invoke();
            UpdateTransaction.WriteAtomic(checkpointPath, new UpdateCheckpoint(manifest.Sequence, manifest.Version));
            lock (gate) { ready = staged; completedPayload = raw; failures = 0; retryPayload = null; DiagnosticCode = null; }
        }
        catch (Exception ex)
        {
            lock (gate)
            {
                DiagnosticCode = ex is InvalidDataException ? ex.Message : "UPDATE_DOWNLOAD_FAILED";
                retryPayload = raw; failures = Math.Min(failures + 1, 5);
                retryDelay = TimeSpan.FromSeconds(Math.Min(300, 30 * (1 << (failures - 1))));
                failedAt = services.Clock.GetTimestamp();
            }
        }
    }
    public void HandoffAccepted(bool accepted)
    {
        lock (gate) { handoffPending = accepted; if (!accepted) { handoffBackoff = true; handoffFailedAt = services.Clock.GetTimestamp(); } }
    }
    public void HandoffFailed() => HandoffAccepted(false);
    public HostAction? IdleHandoff(string status, string minimumVersion)
    {
        lock (gate)
        {
            if (root is null || ready is not { } update || status != "IDLE" || handoffPending) return null;
            if (handoffBackoff && services.Clock.GetElapsedTime(handoffFailedAt, services.Clock.GetTimestamp()) < TimeSpan.FromSeconds(30)) return null;
            if (!Version.TryParse(update.Version, out var version) || !Version.TryParse(runningVersion, out var running) || version <= running ||
                !Version.TryParse(minimumVersion, out var minimum) || version < minimum) return null;
            if (!InStaging(update.EnvelopePath) || !InStaging(update.PackagePath))
            { DiagnosticCode = "INVALID_STAGED_UPDATE_PATH"; ready = null; return null; }
            try
            {
                var checkpoint = JsonSerializer.Deserialize<UpdateCheckpoint>(File.ReadAllBytes(Path.Combine(root, "accepted-release.json")), Wire.Json) ?? throw new InvalidDataException("BAD_CHECKPOINT");
                if (checkpoint.Sequence != update.Sequence || checkpoint.Version != update.Version) throw new InvalidDataException("STAGED_RELEASE_CHANGED");
                var envelope = File.ReadAllBytes(update.EnvelopePath);
                var verified = ReleaseVerifier.Verify(envelope, services.LoadTrust(), platform, osVersion, runningVersion, checkpoint with { Sequence = checkpoint.Sequence - 1 }, services.Clock.GetUtcNow());
                if (verified.Sequence != checkpoint.Sequence || services.Clock.GetUtcNow().AddMinutes(1) >= verified.ExpiresAt) throw new InvalidDataException("METADATA_TOO_CLOSE_TO_EXPIRY");
                using var package = File.OpenRead(update.PackagePath); ReleaseVerifier.VerifyPackage(package, verified);
            }
            catch (Exception ex) { DiagnosticCode = ex is InvalidDataException ? ex.Message : "UPDATE_PREFLIGHT_FAILED"; return null; }
            return new(Guid.NewGuid().ToString(), "UPDATE_READY", UpdateEnvelopePath: update.EnvelopePath, UpdatePackagePath: update.PackagePath, MinimumVersion: minimumVersion);
        }
    }
}
