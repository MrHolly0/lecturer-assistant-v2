namespace Lecturer.Projector;

public enum DisplayConfigQueryPurpose { CurrentActiveLayout, SupportedPathCandidates }

/// <summary>Names/values from Microsoft's WinUser.h and wingdi.h, not application-specific Active/All aliases.</summary>
public static class WindowsDisplayConfig
{
    public const uint QDC_ALL_PATHS = 0x00000001;
    public const uint QDC_ONLY_ACTIVE_PATHS = 0x00000002;
    public const uint SDC_USE_SUPPLIED_DISPLAY_CONFIG = 0x00000020;
    public const uint SDC_VALIDATE = 0x00000040;
    public const uint SDC_APPLY = 0x00000080;
    public const uint SDC_SAVE_TO_DATABASE = 0x00000200;
    public const uint DISPLAYCONFIG_PATH_ACTIVE = 0x00000001;
    public const uint DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE = 1;
    public const uint DISPLAYCONFIG_PIXELFORMAT_32BPP = 4;
    public const uint DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME = 1;
    public const uint DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME = 2;
    public const uint DISPLAYCONFIG_PATH_MODE_IDX_INVALID = 0xffffffff;
    public const int ERROR_INSUFFICIENT_BUFFER = 122;
    public static uint QueryFlags(DisplayConfigQueryPurpose purpose) => purpose switch {
        DisplayConfigQueryPurpose.CurrentActiveLayout => QDC_ONLY_ACTIVE_PATHS,
        DisplayConfigQueryPurpose.SupportedPathCandidates => QDC_ALL_PATHS,
        _ => throw new ArgumentOutOfRangeException(nameof(purpose))
    };
    public static uint TemporarySetFlags(bool validate) => SDC_USE_SUPPLIED_DISPLAY_CONFIG | (validate ? SDC_VALIDATE : SDC_APPLY);
}
