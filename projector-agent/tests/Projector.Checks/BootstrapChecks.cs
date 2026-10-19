using System.IO.Compression;
using System.Security.Cryptography;
using Lecturer.Projector;

internal static class BootstrapChecks
{
    public static int Run()
    {
        var passed = 0;
        void Check(string name, Action body) { body(); Console.WriteLine("PASS " + name); passed++; }
        void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"Expected {expected}, got {actual}"); }
        void Reject(Action body, string code) { try { body(); } catch (InvalidDataException ex) { Equal(code, ex.Message); return; } throw new Exception("Expected rejection " + code); }
        var sandbox = Path.Combine(Path.GetTempPath(), "projector-seed-checks-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(sandbox);
        var platform = OperatingSystem.IsWindows() ? "WINDOWS_X64" : "MACOS_ARM64";
        var entryPoint = platform.StartsWith("WINDOWS", StringComparison.Ordinal) ? "app/Projector.Windows.exe" : "Lecturer Projector Host.app/Contents/MacOS/ProjectorMac";
        var os = new Version(99, 0);
        (string Path, BootstrapManifest Manifest) Seed(string version, string? path = null)
        {
            var file = Path.Combine(sandbox, Guid.NewGuid().ToString("N") + ".zip");
            using (var zip = ZipFile.Open(file, ZipArchiveMode.Create))
            using (var writer = new StreamWriter(zip.CreateEntry(path ?? entryPoint).Open())) writer.Write("synthetic seed " + version);
            return (file, new(version, platform, entryPoint, Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))), new FileInfo(file).Length, "10.0", 1));
        }
        try
        {
            var seed = Seed("0.1.0");
            Check("initial installer preflight is read-only and seed activation is atomic/idempotent", () => {
                var root = Path.Combine(sandbox, "first");
                BootstrapInstallation.Check(root, seed.Manifest, platform, os);
                Equal(false, Directory.Exists(root));
                Equal("INSTALLED", BootstrapInstallation.Install(root, seed.Path, seed.Manifest, platform, os).State);
                var pointer = File.ReadAllText(Path.Combine(root, "current.json"));
                Equal("0.1.0", UpdateTransaction.ReadCurrent(root)!.Version);
                Equal("ALREADY_INSTALLED", BootstrapInstallation.Install(root, seed.Path, seed.Manifest, platform, os).State);
                Equal(pointer, File.ReadAllText(Path.Combine(root, "current.json")));
            });
            Check("a bad seed hash or traversal cannot initialize an installation", () => {
                var root = Path.Combine(sandbox, "bad");
                Reject(() => BootstrapInstallation.Install(root, seed.Path, seed.Manifest with { PackageSha256 = new string('0', 64) }, platform, os), "PACKAGE_HASH_MISMATCH");
                Equal(false, File.Exists(Path.Combine(root, "current.json")));
                var unsafeSeed = Seed("0.1.0", "../escape");
                Reject(() => BootstrapInstallation.Install(root, unsafeSeed.Path, unsafeSeed.Manifest, platform, os), "UNSAFE_ARCHIVE_PATH");
                Equal(false, File.Exists(Path.Combine(root, "current.json")));
                Equal(false, File.Exists(Path.Combine(sandbox, "escape")));
            });
            Check("manual upgrade keeps old slots and an old bundled seed never downgrades an online version", () => {
                var root = Path.Combine(sandbox, "upgrade");
                BootstrapInstallation.Install(root, seed.Path, seed.Manifest, platform, os);
                var old = UpdateTransaction.ReadCurrent(root)!;
                var newer = Seed("0.2.0");
                Equal("UPGRADED", BootstrapInstallation.Install(root, newer.Path, newer.Manifest, platform, os).State);
                Equal("0.2.0", UpdateTransaction.ReadCurrent(root)!.Version);
                Equal(true, File.Exists(UpdateTransaction.EntryPoint(root, old)));
                Equal("0.2.0", BootstrapInstallation.Install(root, seed.Path, seed.Manifest, platform, os).Version);
                Reject(() => BootstrapInstallation.Check(root, seed.Manifest, platform, os), "INSTALLER_DOWNGRADE_OR_PLATFORM_MISMATCH");
            });
            Check("installer and uninstaller refuse active show and incomplete update without deleting state", () => {
                var root = Path.Combine(sandbox, "blocked"); Directory.CreateDirectory(root);
                using (var activeShow = new FileStream(UpdateTransaction.ShowLockPath(root), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                {
                    Reject(() => BootstrapInstallation.Install(root, seed.Path, seed.Manifest, platform, os), "ACTIVE_SHOW");
                    Reject(() => BootstrapInstallation.UninstallCheck(root), "ACTIVE_SHOW");
                }
                File.WriteAllText(Path.Combine(root, "update-transaction.json"), "preserve recovery");
                Reject(() => BootstrapInstallation.Install(root, seed.Path, seed.Manifest, platform, os), "UPDATE_RECOVERY_REQUIRED");
                Reject(() => BootstrapInstallation.UninstallCheck(root), "UPDATE_RECOVERY_REQUIRED");
                Equal("preserve recovery", File.ReadAllText(Path.Combine(root, "update-transaction.json")));
            });
            Check("an idempotent installer still refuses a running show and conflicting same-version seed", () => {
                var root = Path.Combine(sandbox, "repeat-guard");
                BootstrapInstallation.Install(root, seed.Path, seed.Manifest, platform, os);
                var pointer = File.ReadAllText(Path.Combine(root, "current.json"));
                using (var activeShow = new FileStream(UpdateTransaction.ShowLockPath(root), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                    Reject(() => BootstrapInstallation.Install(root, seed.Path, seed.Manifest, platform, os), "ACTIVE_SHOW");
                var conflict = seed.Manifest with { PackageSha256 = new string('a', 64) };
                Reject(() => BootstrapInstallation.Install(root, seed.Path, conflict, platform, os), "SEED_VERSION_CONFLICT");
                Equal(pointer, File.ReadAllText(Path.Combine(root, "current.json")));
            });
            Check("seed architecture, minimum OS and executable path are checked before writing", () => {
                Reject(() => BootstrapInstallation.Validate(seed.Manifest, "WRONG", os), "WRONG_PLATFORM");
                Reject(() => BootstrapInstallation.Validate(seed.Manifest, platform, new Version(1, 0)), "OS_TOO_OLD");
                Reject(() => BootstrapInstallation.Validate(seed.Manifest with { EntryPoint = "app/arbitrary.exe" }, platform, os), "BAD_BOOTSTRAP_ENTRY_POINT");
                Reject(() => BootstrapInstallation.Validate(seed.Manifest with { ProtocolVersion = 2 }, platform, os), "WRONG_PROTOCOL");
            });
            if (!OperatingSystem.IsWindows()) Check("an installer refuses a symlink install root", () => {
                var target = Path.Combine(sandbox, "target"); Directory.CreateDirectory(target);
                var linked = Path.Combine(sandbox, "linked"); Directory.CreateSymbolicLink(linked, target);
                Reject(() => BootstrapInstallation.Install(linked, seed.Path, seed.Manifest, platform, os), "SYMLINK_OR_MISSING_DIRECTORY");
                Equal(0, Directory.GetFileSystemEntries(target).Length);
            });
        }
        finally { Directory.Delete(sandbox, true); }
        return passed;
    }
}
