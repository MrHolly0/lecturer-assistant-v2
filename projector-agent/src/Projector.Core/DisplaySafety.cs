using System.Security.Cryptography;
using System.Text;

namespace Lecturer.Projector;

public sealed record DisplaySnapshot(string Fingerprint, string[] ConnectedIds, string NativeState);
public enum RestoreDecision { Restore, Unchanged, UserChangedConfiguration, HardwareChanged, ConfirmationRequired }
public static class DisplaySafety
{
    public static RestoreDecision CanRestore(DisplaySnapshot original, DisplaySnapshot applied, DisplaySnapshot current, bool locallyConfirmed)
    {
        if (!original.ConnectedIds.Order().SequenceEqual(current.ConnectedIds.Order())) return RestoreDecision.HardwareChanged;
        if (current.Fingerprint == original.Fingerprint) return RestoreDecision.Unchanged;
        if (current.Fingerprint != applied.Fingerprint) return RestoreDecision.UserChangedConfiguration;
        return locallyConfirmed ? RestoreDecision.Restore : RestoreDecision.ConfirmationRequired;
    }
    public static string Fingerprint(string canonicalNativeState) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalNativeState)));
    // Conservative prototype restriction: primary is not necessarily the teacher display.
    // Do not infer physical identity; primary-projector layouts use the browser manual confirmation path.
    public static bool ValidTarget(ScreenInfo[] screens, string id) => screens.Any(s => s.Id == id && !s.IsPrimary && s.Width > 0 && s.Height > 0);
}

/// <summary>Normal update installation is never an automatic transition during a public show.</summary>
public sealed class UpdateLifecycle
{
    public bool Showing { get; set; }
    public string State { get; private set; } = "IDLE";
    public void DownloadVerified() => State = Showing ? "WAITING_FOR_STOP" : "READY_TO_INSTALL";
    public bool RequestInstall()
    {
        if (Showing || State != "READY_TO_INSTALL") return false;
        State = "INSTALLING"; return true;
    }
    public void ShowStopped() { Showing = false; if (State == "WAITING_FOR_STOP") State = "READY_TO_INSTALL"; }
    public void Reconnected(string expectedVersion, string actualVersion)
    {
        if (State != "INSTALLING" || expectedVersion != actualVersion) throw new InvalidOperationException("UPDATE_HEALTH_NOT_CONFIRMED");
        State = "HEALTHY";
    }
}
