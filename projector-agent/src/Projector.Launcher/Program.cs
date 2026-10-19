using System.Diagnostics;
using Lecturer.Projector;
if (args.Length != 1) { Console.Error.WriteLine("Usage: Projector.Launcher <per-user-install-root>"); Environment.ExitCode = 2; return; }
try
{
    var root = Path.GetFullPath(args[0]);
    if (File.Exists(Path.Combine(root, "update-transaction.json"))) throw new InvalidDataException("UPDATE_RECOVERY_REQUIRED");
    var slot = UpdateTransaction.ReadCurrent(root) ?? throw new InvalidDataException("NO_SAFE_INSTALLED_VERSION");
    var start = new ProcessStartInfo(UpdateTransaction.EntryPoint(root, slot)) { UseShellExecute = false };
    start.Environment["LA_PROJECTOR_INSTALL_ROOT"] = root;
    var process = Process.Start(start) ?? throw new InvalidDataException("START_FAILED");
    using (process) { await process.WaitForExitAsync(); Environment.ExitCode = process.ExitCode; }
}
catch (Exception ex) { Console.Error.WriteLine(ex is InvalidDataException ? ex.Message : "LAUNCH_FAILED"); Environment.ExitCode = 1; }
