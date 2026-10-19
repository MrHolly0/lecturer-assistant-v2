using System.Diagnostics;
using System.Text.Json;

namespace Lecturer.Projector;

/// <summary>Receipt is emitted after a successful authenticated poll, never just after Process.Start.</summary>
public sealed class UpdateHealthReporter
{
    public string InstallRoot { get; }
    public HealthChallenge Challenge { get; }
    private bool reported;
    public UpdateHealthReporter(string installRoot, HealthChallenge challenge)
    {
        InstallRoot = Path.GetFullPath(installRoot); Challenge = challenge;
        if (challenge.TransactionId.Length is < 8 or > 80 || !challenge.TransactionId.All(c => char.IsAsciiLetterOrDigit(c) || c == '-') ||
            challenge.Nonce.Length != 64 || !challenge.Nonce.All(Uri.IsHexDigit) ||
            Path.GetFullPath(challenge.ReceiptPath) != Path.Combine(InstallRoot, "health", challenge.TransactionId + ".json"))
            throw new InvalidDataException("BAD_UPDATE_HEALTH_CHALLENGE");
    }
    public static UpdateHealthReporter? FromEnvironment(string version)
    {
        var root = Environment.GetEnvironmentVariable("LA_PROJECTOR_INSTALL_ROOT");
        var id = Environment.GetEnvironmentVariable("LA_PROJECTOR_UPDATE_ID");
        var nonce = Environment.GetEnvironmentVariable("LA_PROJECTOR_UPDATE_NONCE");
        var receipt = Environment.GetEnvironmentVariable("LA_PROJECTOR_HEALTH_PATH");
        if (root is null || id is null || nonce is null || receipt is null) return null;
        return new(root, new(id, nonce, version, receipt));
    }
    public void SuccessfulAuthenticatedPoll()
    {
        if (reported) return;
        Directory.CreateDirectory(Path.GetDirectoryName(Challenge.ReceiptPath)!);
        UpdateTransaction.WriteAtomic(Challenge.ReceiptPath, new UpdateHealth(Challenge.TransactionId, Challenge.Nonce, Challenge.Version, 1, true));
        reported = true;
    }
    public bool StopRequested()
    {
        var path = Path.Combine(InstallRoot, "health", Challenge.TransactionId + ".stop");
        if (!File.Exists(path) || new FileInfo(path).Length > 4096) return false;
        try
        {
            var message = JsonSerializer.Deserialize<UpdateHealth>(File.ReadAllBytes(path), Wire.Json);
            return message is not null && message.TransactionId == Challenge.TransactionId && message.Nonce == Challenge.Nonce;
        }
        catch (IOException) { return false; }
        catch (JsonException) { return false; }
    }
}

public sealed class OutputActivityLock : IDisposable
{
    private readonly string path;
    private FileStream? held;
    public OutputActivityLock(string root) { Directory.CreateDirectory(root); path = UpdateTransaction.ShowLockPath(root); }
    public static OutputActivityLock? FromEnvironment() => Environment.GetEnvironmentVariable("LA_PROJECTOR_INSTALL_ROOT") is { } root ? new(root) : null;
    public bool TryEnter()
    {
        if (held is not null) return true;
        try { held = new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); return true; }
        catch (IOException) { return false; }
    }
    public void Dispose() { held?.Dispose(); held = null; }
}

public sealed class ProcessUpdateProcesses(int? oldPid = null, long? expectedOldStartTicks = null, UpdatePreflight? preflight = null) : IUpdateProcesses
{
    private Process? child;
    private HealthChallenge? currentChallenge;
    private string? currentRoot;
    public async Task WaitForOldExit(CancellationToken ct)
    {
        if (oldPid is null or 0) { preflight?.Ready(); return; }
        Process old;
        try { old = Process.GetProcessById(oldPid.Value); }
        catch (ArgumentException) { preflight?.Ready(); return; }
        using (old)
        {
            if (expectedOldStartTicks is null || ProcessStartIdentity.ReadTicks(old) != expectedOldStartTicks)
                throw new InvalidDataException("OLD_PROCESS_IDENTITY_CHANGED");
            // Reaching this point means signed ZIP extraction and journal creation finished safely.
            preflight?.Ready();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(20));
            await old.WaitForExitAsync(timeout.Token); // No forced termination of an old host/display.
        }
    }
    public Task Start(InstalledSlot slot, string absoluteEntryPoint, HealthChallenge challenge, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var start = new ProcessStartInfo(absoluteEntryPoint) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(absoluteEntryPoint)! };
        currentRoot = Directory.GetParent(Path.GetDirectoryName(challenge.ReceiptPath)!)!.FullName;
        currentChallenge = challenge;
        start.Environment["LA_PROJECTOR_INSTALL_ROOT"] = currentRoot;
        start.Environment["LA_PROJECTOR_UPDATE_ID"] = challenge.TransactionId;
        start.Environment["LA_PROJECTOR_UPDATE_NONCE"] = challenge.Nonce;
        start.Environment["LA_PROJECTOR_HEALTH_PATH"] = challenge.ReceiptPath;
        child = Process.Start(start) ?? throw new InvalidDataException("NEW_PROCESS_DID_NOT_START");
        return Task.CompletedTask;
    }
    public async Task StopFailedCandidate(CancellationToken ct)
    {
        if (child is null || child.HasExited) return;
        if (currentChallenge is null || currentRoot is null) throw new InvalidDataException("NO_CHILD_STOP_CHANNEL");
        UpdateTransaction.WriteAtomic(Path.Combine(currentRoot, "health", currentChallenge.TransactionId + ".stop"),
            new UpdateHealth(currentChallenge.TransactionId, currentChallenge.Nonce, currentChallenge.Version, 1, false));
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(10));
        await child.WaitForExitAsync(timeout.Token); // Native host neutralizes material and exits on its own authenticated stop file.
        child.Dispose(); child = null;
    }
}
