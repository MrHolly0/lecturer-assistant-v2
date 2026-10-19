using System.Diagnostics;
namespace Lecturer.Projector;

public static class NativeUpdateHandoff
{
    public static PendingNativeUpdate StartUpdater(HostAction action, string updaterExecutable, string platform, string osVersion)
    {
        var root = Environment.GetEnvironmentVariable("LA_PROJECTOR_INSTALL_ROOT") ?? throw new InvalidDataException("INSTALLED_LAUNCHER_REQUIRED");
        root = Path.GetFullPath(root);
        var staging = Path.Combine(root, "staging") + Path.DirectorySeparatorChar;
        if (action.UpdateEnvelopePath is null || action.UpdatePackagePath is null || action.MinimumVersion is null ||
            !Path.GetFullPath(action.UpdateEnvelopePath).StartsWith(staging, StringComparison.Ordinal) ||
            !Path.GetFullPath(action.UpdatePackagePath).StartsWith(staging, StringComparison.Ordinal) ||
            !Path.GetFullPath(updaterExecutable).StartsWith(Path.Combine(root, "versions") + Path.DirectorySeparatorChar, StringComparison.Ordinal) ||
            !File.Exists(updaterExecutable)) throw new InvalidDataException("INVALID_UPDATE_HANDOFF");
        using var current = Process.GetCurrentProcess();
        var start = new ProcessStartInfo(updaterExecutable) { UseShellExecute = false };
        foreach (var argument in new[] { "install", action.UpdateEnvelopePath, action.UpdatePackagePath, platform, osVersion, ReleaseInfo.Version,
                     root, root, action.MinimumVersion, current.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), current.StartTime.ToUniversalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture) }) start.ArgumentList.Add(argument);
        // A launcher from a previous update may have left a health challenge in the environment. It is not the updater's identity.
        foreach (var key in new[] { "LA_PROJECTOR_UPDATE_ID", "LA_PROJECTOR_UPDATE_NONCE", "LA_PROJECTOR_HEALTH_PATH" }) start.Environment.Remove(key);
        var id = Guid.NewGuid().ToString("N");
        var challenge = new UpdatePreflight(id, Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)), Path.Combine(root, "health", "preflight-" + id + ".json"), "");
        start.Environment["LA_PROJECTOR_PREFLIGHT_ID"] = challenge.Id;
        start.Environment["LA_PROJECTOR_PREFLIGHT_NONCE"] = challenge.Nonce;
        start.Environment["LA_PROJECTOR_PREFLIGHT_PATH"] = challenge.Path;
        var updater = Process.Start(start) ?? throw new InvalidDataException("UPDATER_DID_NOT_START");
        return new(updater, challenge);
    }
}
