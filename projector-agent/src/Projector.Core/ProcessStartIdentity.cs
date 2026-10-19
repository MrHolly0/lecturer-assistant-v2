using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Lecturer.Projector;

public static class ProcessStartIdentity
{
    public static long ReadTicks(Process process)
    {
        ArgumentNullException.ThrowIfNull(process);
        if (!OperatingSystem.IsMacOS()) return process.StartTime.ToUniversalTime().Ticks;
        var pid = process.Id;
        var info = new MacProcessInfo();
        if (ProcPidInfo(pid, 3, 0, ref info, Marshal.SizeOf<MacProcessInfo>()) != Marshal.SizeOf<MacProcessInfo>() ||
            info.Pid != (uint)pid || info.StartSeconds == 0)
            throw new InvalidDataException("PROCESS_START_IDENTITY_UNAVAILABLE");
        return FromUnixTime(info.StartSeconds, info.StartMicroseconds);
    }

    public static long FromUnixTime(ulong seconds, ulong microseconds)
    {
        if (microseconds >= 1_000_000) throw new InvalidDataException("PROCESS_START_TIME_INVALID");
        try
        {
            var ticks = checked(DateTime.UnixEpoch.Ticks + checked((long)seconds * TimeSpan.TicksPerSecond) + checked((long)microseconds * 10));
            if (ticks > DateTime.MaxValue.Ticks) throw new InvalidDataException("PROCESS_START_TIME_INVALID");
            return ticks;
        }
        catch (OverflowException error) { throw new InvalidDataException("PROCESS_START_TIME_INVALID", error); }
    }

    // macOS SDK sys/proc_info.h: proc_bsdinfo (x86_64/arm64), PROC_PIDTBSDINFO=3.
    // Preserve the kernel's integer microseconds instead of converting through floating point.
    [StructLayout(LayoutKind.Explicit, Size = 136)]
    private struct MacProcessInfo
    {
        [FieldOffset(12)] public uint Pid;
        [FieldOffset(120)] public ulong StartSeconds;
        [FieldOffset(128)] public ulong StartMicroseconds;
    }

    [DllImport("/usr/lib/libproc.dylib", EntryPoint = "proc_pidinfo", SetLastError = true)]
    private static extern int ProcPidInfo(int pid, int flavor, ulong arg, ref MacProcessInfo buffer, int bufferSize);
}
