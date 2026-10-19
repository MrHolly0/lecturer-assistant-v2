using System.Text.Json;
using Lecturer.Projector;

if (args.Length < 1 || args[0] is not ("stage" or "install"))
{
    Console.Error.WriteLine("stage <envelope> <platform> <os-version> <running-version> <state-root> <staging-root> | install <envelope> <verified-zip> <platform> <os-version> <running-version> <state-root> <install-root> <minimum-version> <old-pid-or-0> <old-start-utc-ticks-or-0>");
    Environment.ExitCode = 2; return;
}
try
{
    var trust = EmbeddedTrust.Load(); // Production trust is compiled in. Never accept a key or unsigned URL from the server.
    if (args[0] == "stage")
    {
        if (args.Length != 7) throw new InvalidDataException("BAD_STAGE_ARGUMENTS");
        var stateRoot = Path.GetFullPath(args[5]); var stagingRoot = Path.GetFullPath(args[6]);
        Directory.CreateDirectory(stateRoot); Directory.CreateDirectory(stagingRoot);
        using var processLock = new FileStream(Path.Combine(stateRoot, "updater.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        var checkpointPath = Path.Combine(stateRoot, "accepted-release.json");
        var checkpoint = File.Exists(checkpointPath)
            ? JsonSerializer.Deserialize<UpdateCheckpoint>(File.ReadAllBytes(checkpointPath), Wire.Json) ?? throw new InvalidDataException("BAD_CHECKPOINT")
            : new UpdateCheckpoint(0, args[4]);
        var envelope = await File.ReadAllBytesAsync(args[1]);
        var release = ReleaseVerifier.Verify(envelope, trust, args[2], Version.Parse(args[3]), args[4], checkpoint, DateTimeOffset.UtcNow);
        var zipPath = Path.Combine(stagingRoot, release.Version + "-" + release.Sha256[..16] + ".zip");
        try
        {
            await UpdatePackage.Download(release, zipPath, CancellationToken.None);
            var envelopePath = zipPath + ".envelope.json";
            File.WriteAllBytes(envelopePath, envelope);
            UpdateTransaction.WriteAtomic(checkpointPath, new UpdateCheckpoint(release.Sequence, release.Version));
            Console.WriteLine(JsonSerializer.Serialize(new { state = "VERIFIED_STAGED", release.Version, package = zipPath, envelope = envelopePath }, Wire.Json));
        }
        catch { if (File.Exists(zipPath)) File.Delete(zipPath); throw; }
    }
    else
    {
        if (args.Length != 11) throw new InvalidDataException("BAD_INSTALL_ARGUMENTS");
        // Reverify the signed envelope and zip at install time. A writable staging folder is never trusted.
        var checkpointPath = Path.Combine(Path.GetFullPath(args[6]), "accepted-release.json");
        var checkpoint = JsonSerializer.Deserialize<UpdateCheckpoint>(File.ReadAllBytes(checkpointPath), Wire.Json) ?? throw new InvalidDataException("BAD_CHECKPOINT");
        // This exact already accepted sequence may be installed once. Verification still rejects older/newer substitution and expiry.
        var manifest = ReleaseVerifier.Verify(await File.ReadAllBytesAsync(args[1]), trust, args[3], Version.Parse(args[4]), args[5], checkpoint with { Sequence = checkpoint.Sequence - 1 }, DateTimeOffset.UtcNow);
        if (manifest.Sequence != checkpoint.Sequence || manifest.Version != checkpoint.Version) throw new InvalidDataException("STAGED_RELEASE_CHANGED");
        var pid = int.Parse(args[9]); var ticks = long.Parse(args[10]);
        using var package = File.OpenRead(args[2]);
        var outcome = await new UpdateTransaction(args[7]).Install(package, manifest, args[8], new ProcessUpdateProcesses(pid == 0 ? null : pid, ticks == 0 ? null : ticks, UpdatePreflight.FromEnvironment(args[7], manifest.Version)), TimeSpan.FromSeconds(45), CancellationToken.None);
        Console.WriteLine(JsonSerializer.Serialize(outcome, Wire.Json));
        if (outcome.State != "HEALTHY") Environment.ExitCode = outcome.State == "DEFERRED_ACTIVE_SHOW" ? 3 : 1;
    }
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex is InvalidDataException ? ex.Message : "UPDATE_FAILED"); Environment.ExitCode = 1;
}
