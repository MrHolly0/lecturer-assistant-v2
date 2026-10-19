using System.Text.Json;
using System.Text.Json.Serialization;

namespace Lecturer.Projector;

public static class Wire
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }, MaxDepth = 16
    };
    public const int ProtocolVersion = 1;
    public static readonly HashSet<string> Platforms = ["WINDOWS_X64", "WINDOWS_ARM64", "MACOS_X64", "MACOS_ARM64"];
}
public sealed record ScreenInfo(string Id, string Label, int Width, int Height, bool IsPrimary);
public sealed record PairRequest(string PairingCode, string Name, string Platform, string Version, string OsVersion,
    int ProtocolVersion = 1, Guid? InstallationId = null, string? PreviousDeviceToken = null);
public sealed record PairResponse(Guid DeviceId, string DeviceToken, int ProtocolVersion);
public sealed record AgentAck(Guid CommandId, string Result, string? DiagnosticCode = null);
public sealed record AgentPoll(string Version, int ProtocolVersion, string Status, ScreenInfo[] Screens, AgentAck? Ack = null, string? OsVersion = null);
public sealed record AgentPolicy(bool Allowed, string MinimumVersion);
public sealed record CommandPayload(string? JoinCode = null, string? TargetScreenId = null, string? TestCode = null, string? ProjectionViewToken = null, string? ControlToken = null, Guid? CourseId = null, Guid? SessionId = null);
public sealed record AgentCommand(Guid Id, string Type, DateTimeOffset ExpiresAt, CommandPayload Payload);
public sealed record PollResponse(int ProtocolVersion, int PollAfterMs, DateTimeOffset? LeaseUntil, bool MustStop,
    AgentPolicy Policy, bool UpdateRequired, JsonElement? Release, AgentCommand[] Commands, string? RemoteTheme = null);
public sealed record HostAction(string Id, string Type, string? TargetScreenId = null, string? Url = null, string? TestCode = null, string? UpdateEnvelopePath = null, string? UpdatePackagePath = null, string? MinimumVersion = null, string? RemoteUrl = null, string? ControlToken = null, Guid? CourseId = null, Guid? SessionId = null, string? Theme = null);

public static class LectureWorkspace
{
    public static Uri Build(Uri origin, Guid courseId, Guid sessionId, string token)
    {
        PublicScene.ValidateOrigin(origin.AbsoluteUri);
        if (courseId == Guid.Empty || sessionId == Guid.Empty || !ValidToken(token))
            throw new InvalidDataException("INVALID_LECTURE_CONTROL_GRANT");
        return new Uri(origin, $"/#/helper/remote?courseId={courseId:D}&sessionId={sessionId:D}&controlToken={token}");
    }
    public static bool Allowed(Uri origin, Uri candidate)
    {
        if (candidate.Scheme != origin.Scheme || candidate.Authority != origin.Authority || candidate.UserInfo.Length != 0 || candidate.AbsolutePath != "/" || candidate.Query.Length != 0) return false;
        const string prefix = "#/helper/remote?";
        if (!candidate.Fragment.StartsWith(prefix, StringComparison.Ordinal)) return false;
        var parts = candidate.Fragment[prefix.Length..].Split('&');
        if (parts.Length != 3 || !parts[0].StartsWith("courseId=", StringComparison.Ordinal) || !parts[1].StartsWith("sessionId=", StringComparison.Ordinal) || !parts[2].StartsWith("controlToken=", StringComparison.Ordinal)) return false;
        return Guid.TryParseExact(parts[0][9..], "D", out var course) && course != Guid.Empty && Guid.TryParseExact(parts[1][10..], "D", out var session) && session != Guid.Empty && ValidToken(parts[2][13..]);
    }
    private static bool ValidToken(string token) => token.Length == 101 && Guid.TryParseExact(token[..36], "D", out var id) && id != Guid.Empty && token[36] == '.' && token[37..].All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
}
public sealed record HostResult(string Id, bool Success, string? DiagnosticCode = null, ScreenInfo[]? Screens = null, bool LocalStop = false, bool UpdateHandoffFailed = false);

public static class PublicScene
{
    public static Uri ValidateOrigin(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidDataException("ORIGIN_MUST_BE_HTTPS_ORIGIN");
        return uri;
    }
    public static Uri Build(Uri origin, string code, string? viewToken = null)
    {
        if (code.Length is < 4 or > 32 || code.Any(c => !char.IsAsciiLetterOrDigit(c)))
            throw new InvalidDataException("INVALID_JOIN_CODE");
        if (viewToken is not null && !ValidViewToken(viewToken)) throw new InvalidDataException("INVALID_PROJECTION_VIEW_TOKEN");
        return new Uri(origin, "/#/projection/" + code + (viewToken is null ? "" : "?projectionViewToken=" + viewToken));
    }
    public static bool Allowed(Uri origin, Uri candidate)
    {
        if (candidate.Scheme != origin.Scheme || candidate.Authority != origin.Authority || candidate.UserInfo.Length != 0 ||
            candidate.AbsolutePath != "/" || candidate.Query.Length != 0) return false;
        const string prefix = "#/projection/";
        if (!candidate.Fragment.StartsWith(prefix, StringComparison.Ordinal)) return false;
        var pieces = candidate.Fragment[prefix.Length..].Split('?');
        if (pieces.Length > 2) return false;
        var code = pieces[0];
        if (pieces.Length == 2 && (!pieces[1].StartsWith("projectionViewToken=", StringComparison.Ordinal) || !ValidViewToken(pieces[1]["projectionViewToken=".Length..]))) return false;
        return code.Length is >= 4 and <= 32 && code.All(char.IsAsciiLetterOrDigit);
    }
    private static bool ValidViewToken(string token) => token.Length == 64 && token.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
}
