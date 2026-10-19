using System.Text.Json;

namespace Lecturer.Projector;

/// <summary>The seed is sealed inside the installer/app signature. Later online updates use signed release metadata.</summary>
public sealed record BootstrapManifest(string Version, string Platform, string EntryPoint, string PackageSha256,
    long PackageSize, string MinimumOsVersion, int ProtocolVersion = 1);
public sealed record BootstrapOutcome(string State, string Version);

public static class BootstrapInstallation
{
    public static BootstrapManifest ReadManifest(string path, string platform, Version osVersion)
    {
        if (!File.Exists(path) || new FileInfo(path).Length is < 1 or > 8192 ||
            (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("BAD_BOOTSTRAP_MANIFEST");
        var manifest = JsonSerializer.Deserialize<BootstrapManifest>(File.ReadAllBytes(path), Wire.Json)
            ?? throw new InvalidDataException("BAD_BOOTSTRAP_MANIFEST");
        Validate(manifest, platform, osVersion);
        return manifest;
    }

    public static void Validate(BootstrapManifest manifest, string platform, Version osVersion)
    {
        if (!Wire.Platforms.Contains(platform) || manifest.Platform != platform) throw new InvalidDataException("WRONG_PLATFORM");
        if (manifest.ProtocolVersion != Wire.ProtocolVersion) throw new InvalidDataException("WRONG_PROTOCOL");
        if (!Version.TryParse(manifest.Version, out _) || manifest.Version.Length > 40)
            throw new InvalidDataException("BAD_BOOTSTRAP_VERSION");
        if (!Version.TryParse(manifest.MinimumOsVersion, out var minimum) || osVersion < minimum)
            throw new InvalidDataException("OS_TOO_OLD");
        if (manifest.PackageSize is < 1 or > 536_870_912 || manifest.PackageSha256 is null ||
            manifest.PackageSha256.Length != 64 || !manifest.PackageSha256.All(Uri.IsHexDigit))
            throw new InvalidDataException("BAD_PACKAGE_DIGEST");
        if (string.IsNullOrEmpty(manifest.EntryPoint) || Path.IsPathRooted(manifest.EntryPoint) ||
            manifest.EntryPoint.Contains("..") || manifest.EntryPoint.Contains('\\') || manifest.EntryPoint.Contains(':'))
            throw new InvalidDataException("BAD_ENTRY_POINT");
        var expected = platform.StartsWith("WINDOWS", StringComparison.Ordinal)
            ? "app/Projector.Windows.exe" : "Lecturer Projector Host.app/Contents/MacOS/ProjectorMac";
        if (manifest.EntryPoint != expected) throw new InvalidDataException("BAD_BOOTSTRAP_ENTRY_POINT");
    }

    /// <summary>Read-only installer preflight. Does not create the root or initialize a pointer.</summary>
    public static void Check(string installRoot, BootstrapManifest manifest, string platform, Version osVersion)
    {
        Validate(manifest, platform, osVersion);
        var root = Path.GetFullPath(installRoot);
        using var guards = AcquireGuards(root, false);
        var current = Directory.Exists(root) ? UpdateTransaction.ReadCurrent(root) : null;
        if (current is not null && (current.Platform != manifest.Platform || new Version(current.Version) > new Version(manifest.Version)))
            throw new InvalidDataException("INSTALLER_DOWNGRADE_OR_PLATFORM_MISMATCH");
        if (current is not null && current.Version == manifest.Version &&
            !current.PackageSha256.Equals(manifest.PackageSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("SEED_VERSION_CONFLICT");
    }

    public static void UninstallCheck(string installRoot)
    {
        using var guards = AcquireGuards(Path.GetFullPath(installRoot), false);
    }

    public static BootstrapOutcome Install(string installRoot, string packagePath, BootstrapManifest manifest, string platform, Version osVersion)
    {
        Validate(manifest, platform, osVersion);
        var root = Path.GetFullPath(installRoot);
        if (Directory.Exists(root))
        {
            EnsureDirectory(root);
            using var existingGuards = AcquireGuards(root, true);
            var installed = UpdateTransaction.ReadCurrent(root);
            // A stable app can contain an older seed after an online update. Never downgrade it on the next login.
            if (installed is not null && installed.Platform == platform && new Version(installed.Version) >= new Version(manifest.Version))
            {
                if (installed.Version == manifest.Version && !installed.PackageSha256.Equals(manifest.PackageSha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("SEED_VERSION_CONFLICT");
                return new("ALREADY_INSTALLED", installed.Version);
            }
        }
        if (!File.Exists(packagePath) || (File.GetAttributes(packagePath) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("BAD_SEED_PACKAGE");
        using var package = new FileStream(packagePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        var release = SeedRelease(manifest);
        ReleaseVerifier.VerifyPackage(package, release);
        Directory.CreateDirectory(root);
        EnsureDirectory(root);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        using var guards = AcquireGuards(root, true);
        var previous = UpdateTransaction.ReadCurrent(root);
        if (previous is not null && previous.Platform != platform) throw new InvalidDataException("WRONG_INSTALLED_PLATFORM");
        if (previous is not null && new Version(previous.Version) >= new Version(manifest.Version))
            return new("ALREADY_INSTALLED", previous.Version);
        var versions = Path.Combine(root, "versions");
        Directory.CreateDirectory(versions); EnsureDirectory(versions);
        var slotName = manifest.Version + "-" + manifest.PackageSha256[..16].ToLowerInvariant();
        var destination = Path.Combine(versions, slotName);
        if (File.Exists(Path.Combine(root, "quarantine-" + slotName + ".json"))) throw new InvalidDataException("VERSION_QUARANTINED");
        var temporary = Path.Combine(versions, ".extract-seed-" + Guid.NewGuid().ToString("N"));
        try
        {
            UpdatePackage.ExtractVerified(package, release, temporary);
            if (Directory.Exists(destination))
            {
                EnsureDirectory(destination);
                // An interrupted first installation has no trusted pointer. Never reuse its unverified bytes.
                Directory.Move(destination, Path.Combine(versions, ".abandoned-seed-" + Guid.NewGuid().ToString("N")));
            }
            Directory.Move(temporary, destination);
            var candidate = new InstalledSlot(manifest.Version, platform, slotName, manifest.EntryPoint, manifest.PackageSha256);
            _ = UpdateTransaction.EntryPoint(root, candidate);
            UpdateTransaction.WriteAtomic(Path.Combine(root, "current.json"), candidate);
            return new(previous is null ? "INSTALLED" : "UPGRADED", candidate.Version);
        }
        finally { if (Directory.Exists(temporary)) Directory.Delete(temporary, true); }
    }

    private static ReleaseManifest SeedRelease(BootstrapManifest manifest) => new(1, manifest.Version, manifest.Platform,
        manifest.MinimumOsVersion, manifest.ProtocolVersion, DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch.AddDays(1),
        "https://installer.invalid/embedded-seed", manifest.PackageSize, manifest.PackageSha256, manifest.EntryPoint);

    private static IDisposable AcquireGuards(string root, bool create)
    {
        var guards = new List<IDisposable>();
        try
        {
            if (OperatingSystem.IsWindows())
            {
                var mutex = new Mutex(true, "Local\\LecturerAssistantProjector", out var first);
                guards.Add(mutex);
                if (!first) throw new InvalidDataException("HELPER_RUNNING");
            }
            if (Directory.Exists(root))
            {
                EnsureDirectory(root);
                if (File.Exists(Path.Combine(root, "update-transaction.json"))) throw new InvalidDataException("UPDATE_RECOVERY_REQUIRED");
                foreach (var name in new[] { "update.lock", "show.lock" })
                {
                    var path = Path.Combine(root, name);
                    if (!create && !File.Exists(path)) continue;
                    if (File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException("SYMLINK_INSTALL_LOCK");
                    try { guards.Add(new FileStream(path, create ? FileMode.OpenOrCreate : FileMode.Open, FileAccess.ReadWrite, FileShare.None)); }
                    catch (IOException) { throw new InvalidDataException(name == "show.lock" ? "ACTIVE_SHOW" : "UPDATE_IN_PROGRESS"); }
                }
            }
            // Native macOS keeps the singleton and display journal next to the install root.
            var dataRoot = OperatingSystem.IsMacOS() ? Path.GetDirectoryName(root)! :
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LecturerProjector");
            if (File.Exists(Path.Combine(dataRoot, "display-recovery.json"))) throw new InvalidDataException("DISPLAY_RECOVERY_REQUIRED");
            if (OperatingSystem.IsMacOS())
            {
                var instance = Path.Combine(dataRoot, "instance.lock");
                if (create || File.Exists(instance))
                {
                    if (File.Exists(instance) && (File.GetAttributes(instance) & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException("SYMLINK_INSTALL_LOCK");
                    try { guards.Add(new FileStream(instance, create ? FileMode.OpenOrCreate : FileMode.Open, FileAccess.ReadWrite, FileShare.None)); }
                    catch (IOException) { throw new InvalidDataException("HELPER_RUNNING"); }
                }
            }
            return new GuardSet(guards);
        }
        catch { foreach (var guard in guards.AsEnumerable().Reverse()) guard.Dispose(); throw; }
    }

    private static void EnsureDirectory(string path)
    {
        if (!Directory.Exists(path) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("SYMLINK_OR_MISSING_DIRECTORY");
    }
    private sealed class GuardSet(List<IDisposable> guards) : IDisposable
    {
        public void Dispose() { foreach (var guard in guards.AsEnumerable().Reverse()) guard.Dispose(); }
    }
}
