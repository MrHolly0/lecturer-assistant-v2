using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Lecturer.Projector;

public sealed class AgentClient(HttpClient http, Uri origin, string? token = null)
{
    private async Task<T> Post<T>(string path, object body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(origin, path));
        request.Content = JsonContent.Create(body, options: Wire.Json);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var bounded = new MemoryStream();
        var buffer = new byte[8192];
        while (true)
        {
            var count = await stream.ReadAsync(buffer, ct); if (count == 0) break;
            if (bounded.Length + count > 262_144) throw new InvalidDataException("RESPONSE_TOO_LARGE");
            bounded.Write(buffer, 0, count);
        }
        var bytes = bounded.ToArray();
        return JsonSerializer.Deserialize<T>(bytes, Wire.Json) ?? throw new InvalidDataException("EMPTY_RESPONSE");
    }
    public Task<PairResponse> Pair(PairRequest request, CancellationToken ct) => Post<PairResponse>("/api/v1/projection/agent/pair", request, ct);
    public Task<PollResponse> Poll(AgentPoll request, CancellationToken ct) => Post<PollResponse>("/api/v1/projection/agent/poll", request, ct);
}

public interface IProjectionHost
{
    CancellationToken Closed => CancellationToken.None;
    Task<HostResult> Execute(HostAction action, CancellationToken ct);
}

public sealed class CommandExecutor(Uri origin, IProjectionHost host, OutputActivityLock? activity = null, Func<UpdateTrust>? loadUpdateTrust = null)
{
    private readonly Dictionary<Guid, AgentAck> receipts = [];
    private string? testedTarget;
    public string Status { get; private set; } = "IDLE";
    public async Task NeutralStop(CancellationToken ct)
    {
        testedTarget = null;
        var result = await host.Execute(new(Guid.NewGuid().ToString(), "NEUTRAL_STOP"), ct);
        Status = result.Success ? "IDLE" : "ERROR";
        if (result.Success) activity?.Dispose();
    }
    public async Task<AgentAck> Execute(AgentCommand command, PollResponse poll, ScreenInfo[] screens, DateTimeOffset now, CancellationToken ct)
    {
        if (receipts.TryGetValue(command.Id, out var previous)) return previous;
        AgentAck result;
        try
        {
            if (command.ExpiresAt <= now) throw new InvalidDataException("COMMAND_EXPIRED");
            if (command.Type is not ("CHECK_UPDATE" or "STOP_PROJECTION" or "RESTORE_DISPLAYS") && (!poll.Policy.Allowed || poll.MustStop)) throw new InvalidDataException("POLICY_DENIED");
            if (command.Type == "CHECK_UPDATE")
            {
                if (poll.Release is null || poll.Release.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
                    return Remember(new(command.Id, "FAILED", "RELEASE_FEED_NOT_PUBLISHED"));
                try { _ = (loadUpdateTrust ?? EmbeddedTrust.Load)(); } catch (InvalidDataException) { return Remember(new(command.Id, "FAILED", "RELEASE_SIGNING_NOT_PROVISIONED")); }
                return Remember(new(command.Id, "COMPLETED", "UPDATE_CHECK_REQUESTED"));
            }
            if (command.Type == "STOP_PROJECTION")
            {
                await NeutralStop(ct);
                if (Status != "IDLE") throw new InvalidDataException("NATIVE_STOP_FAILED");
                return Remember(new(command.Id, "COMPLETED", "NEUTRAL_STOPPED_RESTORE_REQUIRES_LOCAL_CONFIRMATION"));
            }
            if (command.Type is "PREPARE_DISPLAYS" or "IDENTIFY_SCREENS" or "RESTORE_DISPLAYS")
            {
                if (command.Type != "IDENTIFY_SCREENS")
                {
                    await NeutralStop(ct);
                    if (Status != "IDLE") throw new InvalidDataException("NATIVE_STOP_FAILED");
                }
                var setup = await host.Execute(new(command.Id.ToString(), command.Type), ct);
                if (!setup.Success) throw new InvalidDataException(setup.DiagnosticCode ?? "DISPLAY_SETUP_FAILED");
                return Remember(new(command.Id, "COMPLETED"));
            }
            if (poll.LeaseUntil is null || poll.LeaseUntil <= now) throw new InvalidDataException("LEASE_EXPIRED");
            if (poll.UpdateRequired) throw new InvalidDataException("UPDATE_REQUIRED");
            if (command.Type == "FOCUS_PRIVATE_REMOTE")
            {
                var remote = LectureWorkspace.Build(origin,
                    command.Payload.CourseId ?? throw new InvalidDataException("COURSE_REQUIRED"),
                    command.Payload.SessionId ?? throw new InvalidDataException("SESSION_REQUIRED"),
                    command.Payload.ControlToken ?? throw new InvalidDataException("CONTROL_GRANT_REQUIRED"));
                var focused = await host.Execute(new(command.Id.ToString(), "FOCUS_PRIVATE_REMOTE", RemoteUrl: remote.AbsoluteUri,
                    ControlToken: command.Payload.ControlToken, CourseId: command.Payload.CourseId, SessionId: command.Payload.SessionId), ct);
                if (!focused.Success) throw new InvalidDataException(focused.DiagnosticCode ?? "REMOTE_OPEN_FAILED");
                return Remember(new(command.Id, "COMPLETED"));
            }
            var target = command.Payload.TargetScreenId ?? throw new InvalidDataException("TARGET_REQUIRED");
            if (!DisplaySafety.ValidTarget(screens, target)) throw new InvalidDataException(screens.Any(s => s.Id == target && s.IsPrimary) ? "PRIMARY_TARGET_REQUIRES_MANUAL_SETUP" : "TARGET_NOT_INDEPENDENT_EXTERNAL");
            HostAction action;
            if (command.Type == "TEST_TARGET")
            {
                var code = command.Payload.TestCode ?? throw new InvalidDataException("TEST_CODE_REQUIRED");
                if (code.Length is < 4 or > 12 || !code.All(char.IsAsciiLetterOrDigit)) throw new InvalidDataException("INVALID_TEST_CODE");
                action = new(command.Id.ToString(), "TEST_TARGET", target, TestCode: code);
            }
            else if (command.Type == "START_PUBLIC_PROJECTION")
            {
                if (testedTarget != target) throw new InvalidDataException("PHYSICAL_TEST_REQUIRED");
                string? remoteUrl = command.Payload.ControlToken is null ? null : LectureWorkspace.Build(origin,
                    command.Payload.CourseId ?? throw new InvalidDataException("COURSE_REQUIRED"),
                    command.Payload.SessionId ?? throw new InvalidDataException("SESSION_REQUIRED"), command.Payload.ControlToken).AbsoluteUri;
                action = new(command.Id.ToString(), "START_PUBLIC_PROJECTION", target, PublicScene.Build(origin, command.Payload.JoinCode ?? "", command.Payload.ProjectionViewToken).AbsoluteUri,
                    RemoteUrl: remoteUrl, ControlToken: command.Payload.ControlToken, CourseId: command.Payload.CourseId, SessionId: command.Payload.SessionId);
            }
            else throw new InvalidDataException("UNKNOWN_COMMAND");
            if (activity is not null && !activity.TryEnter()) throw new InvalidDataException("UPDATE_INSTALLING");
            var native = await host.Execute(action, ct);
            if (!native.Success) throw new InvalidDataException(native.DiagnosticCode ?? "NATIVE_HOST_FAILED");
            if (command.Type == "TEST_TARGET") { testedTarget = target; Status = "TESTING"; }
            else Status = "SHOWING";
            result = new(command.Id, "COMPLETED");
        }
        catch (Exception ex) when ((ex is InvalidDataException or InvalidOperationException) && ex.Message != "NATIVE_HOST_CLOSED")
        { result = new(command.Id, "FAILED", ex.Message); }
        return Remember(result);
    }
    public void TopologyChanged() { testedTarget = null; }
    private AgentAck Remember(AgentAck ack)
    {
        if (receipts.Count >= 2048) receipts.Remove(receipts.Keys.First());
        receipts[ack.CommandId] = ack; return ack;
    }
}
