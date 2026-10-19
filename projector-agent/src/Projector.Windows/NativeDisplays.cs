using System.Runtime.InteropServices;
using System.Text.Json;
using Lecturer.Projector;
using static Lecturer.Projector.WindowsDisplayConfig;
namespace Lecturer.Projector.Windows;

internal sealed class NativeDisplays
{
    private static readonly JsonSerializerOptions Json = new(Wire.Json) { IncludeFields = true };
    private readonly string journalPath;
    private DisplayJournal? journal;
    public NativeDisplays(string directory) { journalPath = Path.Combine(directory, "display-recovery.json"); }
    public record Configuration(PathInfo[] Paths, ModeInfo[] Modes);
    private record DisplayJournal(DisplaySnapshot Original, DisplaySnapshot? Applied);
    public static Configuration Read(DisplayConfigQueryPurpose purpose = DisplayConfigQueryPurpose.CurrentActiveLayout)
    {
        var flags = QueryFlags(purpose);
        for (var retry = 0; retry < 4; retry++)
        {
            Check(GetDisplayConfigBufferSizes(flags, out var paths, out var modes));
            var pathArray = new PathInfo[paths]; var modeArray = new ModeInfo[modes];
            var code = QueryDisplayConfig(flags, ref paths, pathArray, ref modes, modeArray, IntPtr.Zero);
            if (code == ERROR_INSUFFICIENT_BUFFER) continue; Check(code);
            return new(pathArray.Take((int)paths).ToArray(), modeArray.Take((int)modes).ToArray());
        }
        throw new InvalidDataException("DISPLAY_TOPOLOGY_UNSTABLE");
    }
    public static DisplaySnapshot Snapshot()
    {
        var state = Read(); var serialized = JsonSerializer.Serialize(state, Json);
        var semantic = state.Paths.OrderBy(TargetId).Select(path => new {
            target = TargetId(path), source = $"{path.Source.Adapter.High}:{path.Source.Adapter.Low}:{path.Source.Id}",
            sourceMode = path.Source.ModeIndex < state.Modes.Length ? Convert.ToHexString(state.Modes[path.Source.ModeIndex].Data) : "none",
            targetMode = path.Target.ModeIndex < state.Modes.Length ? Convert.ToHexString(state.Modes[path.Target.ModeIndex].Data) : "none",
            path.Target.Rotation, path.Target.Scaling, path.Target.RefreshNumerator, path.Target.RefreshDenominator, path.Target.ScanLineOrdering
        });
        return new(DisplaySafety.Fingerprint(JsonSerializer.Serialize(semantic, Json)), state.Paths.Select(HardwareId).Distinct().Order().ToArray(), serialized);
    }
    private static string HardwareId(PathInfo path)
    {
        var name = new TargetName { Header = new DeviceHeader { Type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME, Size = (uint)Marshal.SizeOf<TargetName>(), Adapter = path.Target.Adapter, Id = path.Target.Id }, FriendlyName = "", DevicePath = "" };
        Check(DisplayConfigGetDeviceInfo(ref name));
        return TargetId(path) + ":" + name.DevicePath;
    }
    public static string ScreenIdentity(Screen screen)
    {
        var state = Read();
        foreach (var path in state.Paths)
        {
            var name = new SourceName { Header = new DeviceHeader { Type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, Size = (uint)Marshal.SizeOf<SourceName>(), Adapter = path.Source.Adapter, Id = path.Source.Id }, GdiName = "" };
            Check(DisplayConfigGetDeviceInfo(ref name));
            if (name.GdiName == screen.DeviceName) return HardwareId(path);
        }
        throw new InvalidDataException("SCREEN_IDENTITY_UNAVAILABLE");
    }
    private static string TargetId(PathInfo path) => $"{path.Target.Adapter.High}:{path.Target.Adapter.Low}:{path.Target.Id}";
    public void PrepareIndependent()
    {
        if (File.Exists(journalPath)) throw new InvalidDataException("RESTORE_OR_KEEP_EXISTING_CONFIGURATION_FIRST");
        var original = Snapshot(); var active = Read(); var possibilities = Read(DisplayConfigQueryPurpose.SupportedPathCandidates);
        if (active.Paths.Length < 2) throw new InvalidDataException("NO_EXTERNAL_DISPLAY");
        var unique = active.Paths.Select(p => $"{p.Source.Adapter.High}:{p.Source.Adapter.Low}:{p.Source.Id}").Distinct().Count();
        if (unique == active.Paths.Length) return;
        var used = new HashSet<string>(); var paths = new List<PathInfo>(); var modes = new List<ModeInfo>(); var x = 0;
        foreach (var current in active.Paths)
        {
            var candidates = possibilities.Paths.Where(p => p.Target.Available != 0 && TargetId(p) == TargetId(current))
                .OrderByDescending(p => p.Source.Id == current.Source.Id).ToArray();
            var available = candidates.Where(p => !used.Contains($"{p.Source.Adapter.High}:{p.Source.Adapter.Low}:{p.Source.Id}")).ToArray();
            if (available.Length == 0) throw new InvalidDataException("NO_INDEPENDENT_DISPLAY_PATH");
            var selected = available[0]; used.Add($"{selected.Source.Adapter.High}:{selected.Source.Adapter.Low}:{selected.Source.Id}");
            if (current.Source.ModeIndex >= active.Modes.Length) throw new InvalidDataException("SOURCE_MODE_UNAVAILABLE");
            var previous = active.Modes[current.Source.ModeIndex];
            var mode = new ModeInfo { Type = DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE, Id = selected.Source.Id, Adapter = selected.Source.Adapter, Data = new byte[48] };
            var width = BitConverter.ToUInt32(previous.Data, 0); var height = BitConverter.ToUInt32(previous.Data, 4);
            if (width == 0 || height == 0) throw new InvalidDataException("INVALID_SOURCE_MODE");
            BitConverter.GetBytes(width).CopyTo(mode.Data, 0); BitConverter.GetBytes(height).CopyTo(mode.Data, 4);
            BitConverter.GetBytes(DISPLAYCONFIG_PIXELFORMAT_32BPP).CopyTo(mode.Data, 8); // DISPLAYCONFIG_PIXELFORMAT_32BPP
            BitConverter.GetBytes(x).CopyTo(mode.Data, 12); BitConverter.GetBytes(0).CopyTo(mode.Data, 16);
            selected.Source.ModeIndex = (uint)modes.Count; selected.Target.ModeIndex = DISPLAYCONFIG_PATH_MODE_IDX_INVALID; selected.Flags = DISPLAYCONFIG_PATH_ACTIVE;
            modes.Add(mode); paths.Add(selected); x += checked((int)width);
        }
        var newPaths = paths.ToArray(); var newModes = modes.ToArray();
        Check(SetDisplayConfig((uint)newPaths.Length, newPaths, (uint)newModes.Length, newModes, TemporarySetFlags(validate: true)));
        // Persist the original before the first mutation. A crash before the applied fingerprint leaves a manual-recovery journal.
        journal = new(original, null); UpdateTransaction.WriteAtomic(journalPath, journal);
        // Deliberately no SDC_SAVE_TO_DATABASE and no global DisplaySwitch/Win+P process.
        Check(SetDisplayConfig((uint)newPaths.Length, newPaths, (uint)newModes.Length, newModes, TemporarySetFlags(validate: false)));
        journal = new(original, Snapshot());
        UpdateTransaction.WriteAtomic(journalPath, journal);
    }
    public string Restore(bool confirmed)
    {
        journal ??= File.Exists(journalPath) ? JsonSerializer.Deserialize<DisplayJournal>(File.ReadAllBytes(journalPath), Json) : null;
        if (journal is null) return "UNCHANGED";
        var current = Snapshot();
        if (journal.Applied is null)
        {
            if (current.Fingerprint != journal.Original.Fingerprint) return "PREPARATION_INTERRUPTED_USE_MANUAL_RECOVERY";
            File.Delete(journalPath); journal = null; return "Unchanged";
        }
        var decision = DisplaySafety.CanRestore(journal.Original, journal.Applied, current, confirmed);
        if (decision == RestoreDecision.Restore)
        {
            var state = JsonSerializer.Deserialize<Configuration>(journal.Original.NativeState, Json) ?? throw new InvalidDataException("BAD_DISPLAY_JOURNAL");
            Check(SetDisplayConfig((uint)state.Paths.Length, state.Paths, (uint)state.Modes.Length, state.Modes, TemporarySetFlags(validate: true)));
            Check(SetDisplayConfig((uint)state.Paths.Length, state.Paths, (uint)state.Modes.Length, state.Modes, TemporarySetFlags(validate: false)));
        }
        if (decision is RestoreDecision.Restore or RestoreDecision.Unchanged) { File.Delete(journalPath); journal = null; }
        return decision.ToString();
    }
    private static void Check(int error) { if (error != 0) throw new InvalidDataException("DISPLAY_API_" + error); }
    [StructLayout(LayoutKind.Sequential)] public struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] public struct SourceInfo { public Luid Adapter; public uint Id, ModeIndex, Flags; }
    [StructLayout(LayoutKind.Sequential)] public struct TargetInfo
    {
        public Luid Adapter; public uint Id, ModeIndex, Technology, Rotation, Scaling, RefreshNumerator, RefreshDenominator, ScanLineOrdering, Available, Flags;
    }
    [StructLayout(LayoutKind.Sequential)] public struct PathInfo { public SourceInfo Source; public TargetInfo Target; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] public struct ModeInfo
    {
        public uint Type, Id; public Luid Adapter; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 48)] public byte[] Data;
    }
    [StructLayout(LayoutKind.Sequential)] private struct DeviceHeader { public uint Type, Size; public Luid Adapter; public uint Id; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct SourceName
    {
        public DeviceHeader Header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string GdiName;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct TargetName
    {
        public DeviceHeader Header; public uint Flags, Technology; public ushort Manufacturer, Product; public uint Connector;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string FriendlyName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DevicePath;
    }
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref SourceName request);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref TargetName request);
    [DllImport("user32.dll")] private static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll")] private static extern int QueryDisplayConfig(uint flags, ref uint paths, [Out] PathInfo[] pathArray, ref uint modes, [Out] ModeInfo[] modeArray, IntPtr topology);
    [DllImport("user32.dll")] private static extern int SetDisplayConfig(uint paths, [In] PathInfo[] pathArray, uint modes, [In] ModeInfo[] modeArray, uint flags);
}
