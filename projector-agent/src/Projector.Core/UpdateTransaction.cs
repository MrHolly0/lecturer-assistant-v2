using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace Lecturer.Projector;

public sealed record InstalledSlot(string Version, string Platform, string Slot, string EntryPoint, string PackageSha256);
public sealed record UpdateHealth(string TransactionId, string Nonce, string Version, int ProtocolVersion, bool SuccessfulPoll);
public sealed record HealthChallenge(string TransactionId, string Nonce, string Version, string ReceiptPath);
public sealed record InstallOutcome(string State, string? Version, string? DiagnosticCode = null);
public sealed record UpdateJournal(string TransactionId, string Phase, InstalledSlot? Previous, InstalledSlot Candidate);

public interface IUpdateProcesses
{
    Task WaitForOldExit(CancellationToken ct);
    Task Start(InstalledSlot slot, string absoluteEntryPoint, HealthChallenge challenge, CancellationToken ct);
    Task StopFailedCandidate(CancellationToken ct);
}

/// <summary>Only verified packages reach immutable slots. Pointer activation is reversible until a real successful backend poll.</summary>
public sealed class UpdateTransaction(string installRoot, TimeProvider? clock = null)
{
    private readonly string root = Path.GetFullPath(installRoot);
    private string PointerPath => Path.Combine(root, "current.json");
    public static string ShowLockPath(string root) => Path.Combine(Path.GetFullPath(root), "show.lock");
    public async Task<InstallOutcome> Install(Stream package, ReleaseManifest manifest, string minimumVersion,
        IUpdateProcesses processes, TimeSpan healthTimeout, CancellationToken ct)
    {
        if (healthTimeout < TimeSpan.FromMilliseconds(100) || healthTimeout > TimeSpan.FromMinutes(3)) throw new InvalidDataException("BAD_HEALTH_TIMEOUT");
        if (!Version.TryParse(minimumVersion, out var minimum) || !Version.TryParse(manifest.Version, out var candidateVersion) || candidateVersion < minimum)
            throw new InvalidDataException("RELEASE_BELOW_MINIMUM");
        Directory.CreateDirectory(root); EnsureRealDirectory(root);
        using var transactionLock = new FileStream(Path.Combine(root, "update.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        FileStream showLock;
        try { showLock = new FileStream(ShowLockPath(root), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { return new("DEFERRED_ACTIVE_SHOW", null); }
        using (showLock)
        {
            if (File.Exists(Path.Combine(root, "update-transaction.json"))) throw new InvalidDataException("UNFINISHED_TRANSACTION_REQUIRES_RECOVERY");
            var previous = ReadCurrent(root);
            var candidate = new InstalledSlot(manifest.Version, manifest.Platform, manifest.Version + "-" + manifest.Sha256[..16].ToLowerInvariant(), manifest.EntryPoint, manifest.Sha256);
            ValidateSlot(candidate);
            var slots = Path.Combine(root, "versions"); Directory.CreateDirectory(slots); EnsureRealDirectory(slots);
            var destination = Path.Combine(slots, candidate.Slot);
            if (File.Exists(Path.Combine(root, "quarantine-" + candidate.Slot + ".json"))) throw new InvalidDataException("VERSION_QUARANTINED");
            if (previous?.Slot == candidate.Slot) throw new InvalidDataException("VERSION_SLOT_IS_ACTIVE");
            // Recover only our own uncommitted extraction directories, under the update lock.
            foreach (var abandoned in Directory.GetDirectories(slots, ".extract-*"))
            {
                EnsureRealDirectory(abandoned);
                if (previous is null || Path.GetFullPath(abandoned) != Path.GetFullPath(Path.Combine(slots, previous.Slot))) Directory.Delete(abandoned, true);
            }
            var temporarySlot = Path.Combine(slots, ".extract-" + Guid.NewGuid().ToString("N"));
            try
            {
                // Never extract directly into an immutable final slot: interruption must be retryable.
                UpdatePackage.ExtractVerified(package, manifest, temporarySlot);
                if (Directory.Exists(destination))
                {
                    EnsureRealDirectory(destination);
                    // Recover a pre-journal orphan from an interrupted older installer without trusting its bytes.
                    Directory.Move(destination, Path.Combine(slots, ".abandoned-" + candidate.Slot + "-" + Guid.NewGuid().ToString("N")));
                }
                Directory.Move(temporarySlot, destination); // Atomic same-volume publication of a completely verified extraction.
            }
            finally
            {
                if (Directory.Exists(temporarySlot)) Directory.Delete(temporarySlot, true);
            }
            var id = Guid.NewGuid().ToString("N");
            var journal = new UpdateJournal(id, "STAGED", previous, candidate);
            WriteJournal(journal);
            var oldExited = false;
            try
            {
                if ((clock ?? TimeProvider.System).GetUtcNow().AddMinutes(1) >= manifest.ExpiresAt) throw new InvalidDataException("METADATA_TOO_CLOSE_TO_EXPIRY");
                await processes.WaitForOldExit(ct); // Never kill a potentially active old native host.
                oldExited = true;
                WriteJournal(journal with { Phase = "OLD_EXITED" });
                WriteAtomic(PointerPath, candidate);
                WriteJournal(journal with { Phase = "ACTIVATED" });
                var healthy = await StartAndCheck(candidate, processes, id, healthTimeout, ct);
                if (!healthy) throw new InvalidDataException("NEW_VERSION_HEALTH_TIMEOUT");
                WriteJournal(journal with { Phase = "HEALTHY" });
                File.Delete(Path.Combine(root, "update-transaction.json"));
                return new("HEALTHY", candidate.Version);
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                if (!oldExited)
                {
                    // A failed/expired preflight must leave the still-running old host and pointer alone.
                    File.Delete(Path.Combine(root, "update-transaction.json"));
                    return new("PREFLIGHT_CANCELLED_OLD_HOST_KEPT", previous?.Version, "OLD_HOST_KEPT_RUNNING");
                }
                // The new candidate must acknowledge neutral stop/exit. A failed stop never activates a second process.
                try { await processes.StopFailedCandidate(CancellationToken.None); }
                catch { WriteJournal(journal with { Phase = "FAILED_PROCESS_STILL_RUNNING" }); return new("RECOVERY_REQUIRED", null, "CANDIDATE_DID_NOT_EXIT"); }
                Quarantine(candidate, ex is InvalidDataException data ? data.Message : "INSTALL_FAILED");
                if (previous is not null && Version.TryParse(previous.Version, out var oldVersion) && oldVersion >= minimum)
                {
                    try
                    {
                        WriteAtomic(PointerPath, previous);
                        WriteJournal(journal with { Phase = "ROLLING_BACK" });
                        if (await StartAndCheck(previous, processes, id + "-rollback", healthTimeout, CancellationToken.None))
                        {
                            File.Delete(Path.Combine(root, "update-transaction.json"));
                            return new("ROLLED_BACK", previous.Version, "NEW_VERSION_FAILED");
                        }
                        await processes.StopFailedCandidate(CancellationToken.None);
                    }
                    catch { /* Keep failed/unsafe versions out of the active pointer. */ }
                }
                // A revoked version must never regain show permission through rollback.
                if (File.Exists(PointerPath)) File.Delete(PointerPath);
                WriteJournal(journal with { Phase = "NO_SAFE_VERSION" });
                return new("QUARANTINED_BROWSER_REQUIRED", null, "NO_HEALTHY_ALLOWED_ROLLBACK");
            }
        }
    }
    private async Task<bool> StartAndCheck(InstalledSlot slot, IUpdateProcesses processes, string id, TimeSpan timeout, CancellationToken ct)
    {
        var healthDirectory = Path.Combine(root, "health"); Directory.CreateDirectory(healthDirectory); EnsureRealDirectory(healthDirectory);
        var receipt = Path.Combine(healthDirectory, id + ".json");
        if (File.Exists(receipt)) File.Delete(receipt);
        var challenge = new HealthChallenge(id, Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), slot.Version, receipt);
        await processes.Start(slot, EntryPoint(root, slot), challenge, ct);
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < timeout)
        {
            ct.ThrowIfCancellationRequested();
            if (File.Exists(receipt))
            {
                if (new FileInfo(receipt).Length > 4096) return false;
                try
                {
                    var health = JsonSerializer.Deserialize<UpdateHealth>(File.ReadAllBytes(receipt), Wire.Json);
                    if (health is not null && health.TransactionId == id && health.Version == slot.Version && health.ProtocolVersion == 1 &&
                        health.SuccessfulPoll && CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(health.Nonce), System.Text.Encoding.UTF8.GetBytes(challenge.Nonce)))
                    { File.Delete(receipt); return true; }
                    return false;
                }
                catch (IOException) { }
                catch (JsonException) { return false; }
            }
            await Task.Delay(50, ct);
        }
        return false;
    }
    public static InstalledSlot? ReadCurrent(string installRoot)
    {
        var file = Path.Combine(installRoot, "current.json"); if (!File.Exists(file)) return null;
        if (new FileInfo(file).Length > 8192) throw new InvalidDataException("BAD_CURRENT_POINTER");
        var slot = JsonSerializer.Deserialize<InstalledSlot>(File.ReadAllBytes(file), Wire.Json) ?? throw new InvalidDataException("BAD_CURRENT_POINTER");
        ValidateSlot(slot); _ = EntryPoint(installRoot, slot); return slot;
    }
    public static string EntryPoint(string installRoot, InstalledSlot slot)
    {
        ValidateSlot(slot);
        var directory = Path.GetFullPath(Path.Combine(installRoot, "versions", slot.Slot));
        EnsureRealDirectory(directory);
        var file = Path.GetFullPath(Path.Combine(directory, slot.EntryPoint));
        if (!file.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(file)) throw new InvalidDataException("INVALID_INSTALLED_ENTRY_POINT");
        for (var current = new FileInfo(file).Directory; current is not null && current.FullName.Length >= directory.Length; current = current.Parent) EnsureRealDirectory(current.FullName);
        if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("SYMLINK_ENTRY_POINT");
        return file;
    }
    public static void WriteAtomic<T>(string file, T value)
    {
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".new";
        using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        { JsonSerializer.Serialize(output, value, Wire.Json); output.Flush(true); }
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.Move(temporary, file, true);
    }
    private static void ValidateSlot(InstalledSlot slot)
    {
        if (!Version.TryParse(slot.Version, out _) || slot.Slot.Length > 100 || slot.Slot.Length == 0 ||
            slot.Slot.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '.' or '-')) || slot.Slot.Contains("..") ||
            !Wire.Platforms.Contains(slot.Platform) || string.IsNullOrEmpty(slot.EntryPoint) || Path.IsPathRooted(slot.EntryPoint) || slot.EntryPoint.Contains("..") || slot.EntryPoint.Contains('\\') || slot.EntryPoint.Contains(':'))
            throw new InvalidDataException("INVALID_VERSION_SLOT");
    }
    private static void EnsureRealDirectory(string path)
    {
        if (!Directory.Exists(path) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("SYMLINK_OR_MISSING_DIRECTORY");
    }
    private void WriteJournal(UpdateJournal journal) => WriteAtomic(Path.Combine(root, "update-transaction.json"), journal);
    private void Quarantine(InstalledSlot slot, string code) => WriteAtomic(Path.Combine(root, "quarantine-" + slot.Slot + ".json"), new { slot.Version, slot.PackageSha256, diagnosticCode = code, quarantinedAt = DateTimeOffset.UtcNow });
}
