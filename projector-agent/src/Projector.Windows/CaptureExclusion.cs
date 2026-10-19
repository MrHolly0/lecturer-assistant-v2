using System.Runtime.InteropServices;

namespace Lecturer.Projector.Windows;

internal sealed record CaptureExclusion(bool Supported, bool Enabled, string? Error = null)
{
    private const uint ExcludeFromCapture = 0x11;

    public static CaptureExclusion Apply(IntPtr window)
    {
        // Earlier versions interpret 0x11 as WDA_MONITOR, producing a blank rectangle.
        // Do not claim that older behaviour hides the remote.
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
            return new(false, false, "WINDOWS_10_2004_REQUIRED");
        if (DwmIsCompositionEnabled(out var composed) != 0 || !composed)
            return new(true, false, "DESKTOP_COMPOSITION_UNAVAILABLE");
        if (!SetWindowDisplayAffinity(window, ExcludeFromCapture))
            return new(true, false, "DISPLAY_AFFINITY_SET_" + Marshal.GetLastWin32Error());
        if (!GetWindowDisplayAffinity(window, out var actual) || actual != ExcludeFromCapture)
            return new(true, false, "DISPLAY_AFFINITY_NOT_CONFIRMED");
        return new(true, true);
    }

    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowDisplayAffinity(IntPtr window, uint affinity);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowDisplayAffinity(IntPtr window, out uint affinity);
    [DllImport("dwmapi.dll")] private static extern int DwmIsCompositionEnabled([MarshalAs(UnmanagedType.Bool)] out bool enabled);
}
