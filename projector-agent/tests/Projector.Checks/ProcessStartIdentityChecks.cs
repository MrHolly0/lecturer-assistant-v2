using System.Diagnostics;
using Lecturer.Projector;

internal static class ProcessStartIdentityChecks
{
    public static int Run()
    {
        var passed = 0;
        void Check(string name, Action action) { action(); Console.WriteLine("PASS " + name); passed++; }
        void Equal(long expected, long actual) { if (expected != actual) throw new Exception("Process start timestamp precision changed"); }
        void Reject(ulong seconds, ulong microseconds)
        {
            try { _ = ProcessStartIdentity.FromUnixTime(seconds, microseconds); }
            catch (InvalidDataException error) when (error.Message == "PROCESS_START_TIME_INVALID") { return; }
            throw new Exception("Invalid process start timestamp was accepted");
        }
        Check("process identity converts epoch and every microsecond using integer ticks", () => {
            Equal(621_355_968_000_000_000, ProcessStartIdentity.FromUnixTime(0, 0));
            Equal(621_355_968_010_000_000, ProcessStartIdentity.FromUnixTime(1, 0));
            Equal(621_355_968_010_000_010, ProcessStartIdentity.FromUnixTime(1, 1));
            Equal(621_355_968_019_999_990, ProcessStartIdentity.FromUnixTime(1, 999_999));
            Equal(638_355_968_001_234_560, ProcessStartIdentity.FromUnixTime(1_700_000_000, 123_456));
        });
        Check("process identity rejects out-of-range microseconds and integer or DateTime overflow", () => {
            Equal(DateTime.MaxValue.Ticks - 9, ProcessStartIdentity.FromUnixTime(253_402_300_799, 999_999));
            Reject(0, 1_000_000); Reject(1, ulong.MaxValue); Reject(253_402_300_800, 0);
            Reject(ulong.MaxValue, 0); Reject((ulong)long.MaxValue, 999_999);
        });
        Check("own process start identity is stable and uses the platform's exact timestamp", () => {
            using var current = Process.GetCurrentProcess();
            using var reopened = Process.GetProcessById(current.Id);
            var first = ProcessStartIdentity.ReadTicks(current); var second = ProcessStartIdentity.ReadTicks(reopened);
            if (first <= DateTime.UnixEpoch.Ticks || first > DateTime.UtcNow.Ticks) throw new Exception("Own process timestamp is unavailable");
            Equal(first, second);
            if (OperatingSystem.IsMacOS()) Equal(0, first % 10);
            else Equal(current.StartTime.ToUniversalTime().Ticks, first);
        });
        return passed;
    }
}
