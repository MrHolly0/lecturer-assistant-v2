using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Lecturer.Projector;

var maintenance = args.Length > 0 && args[0] is "bootstrap" or "bootstrap-check" or "uninstall-check";
var interactive = !maintenance && args.Length is 1 or 2;
try
{
    var platform = (OperatingSystem.IsWindows() ? "WINDOWS_" : OperatingSystem.IsMacOS() ? "MACOS_" : "UNSUPPORTED_") +
        (RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "ARM64" : "X64");
    if (args is ["bootstrap", var installRoot, var package, var metadata])
    {
        var manifest = BootstrapInstallation.ReadManifest(metadata, platform, Environment.OSVersion.Version);
        Console.WriteLine(JsonSerializer.Serialize(BootstrapInstallation.Install(installRoot, package, manifest, platform, Environment.OSVersion.Version), Wire.Json));
        return;
    }
    if (args is ["bootstrap-check", var checkRoot, var checkMetadata])
    {
        var manifest = BootstrapInstallation.ReadManifest(checkMetadata, platform, Environment.OSVersion.Version);
        BootstrapInstallation.Check(checkRoot, manifest, platform, Environment.OSVersion.Version);
        Console.WriteLine("INSTALLATION_READY"); return;
    }
    if (args is ["uninstall-check", var removeRoot])
    {
        BootstrapInstallation.UninstallCheck(removeRoot); Console.WriteLine("UNINSTALL_READY"); return;
    }
    if (args.Length is not (1 or 2)) throw new InvalidDataException("EXPECTED_INSTALL_ROOT_OR_BOOTSTRAP_COMMAND");
    if (args.Length == 2) _ = PairLink.Parse(args[1]);
    var root = Path.GetFullPath(args[0]);
    if (File.Exists(Path.Combine(root, "update-transaction.json"))) throw new InvalidDataException("UPDATE_RECOVERY_REQUIRED");
    var slot = UpdateTransaction.ReadCurrent(root) ?? throw new InvalidDataException("NO_SAFE_INSTALLED_VERSION");
    if (slot.Platform != platform) throw new InvalidDataException("WRONG_INSTALLED_PLATFORM");
    var start = new ProcessStartInfo(UpdateTransaction.EntryPoint(root, slot)) { UseShellExecute = false };
    if (args.Length == 2) start.ArgumentList.Add(args[1]);
    start.Environment["LA_PROJECTOR_INSTALL_ROOT"] = root;
    var process = Process.Start(start) ?? throw new InvalidDataException("START_FAILED");
    using (process) { await process.WaitForExitAsync(); Environment.ExitCode = process.ExitCode; }
}
catch (Exception ex)
{
    var code = ex is InvalidDataException ? ex.Message : "LAUNCH_FAILED";
    Console.Error.WriteLine(code); Environment.ExitCode = 1;
#if WINDOWS
    // Installer automation receives only an exit code. Ordinary shortcuts explain a failed launch.
    if (interactive)
        System.Windows.Forms.MessageBox.Show("Не удалось запустить помощник проектора.\n\nКод: " + code +
            "\nИспользуйте настройку проектора на сайте или переустановите помощник.", "Lecturer Assistant",
            System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Warning);
#endif
}
