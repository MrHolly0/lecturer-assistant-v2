using System.Reflection;
using System.Text.Json;
using Lecturer.Projector;

var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0";
if (args.SequenceEqual(["--self-test"]))
{
    Console.WriteLine($"Projector coordinator {version} protocol 1; no display, network or startup changes performed.");
    return;
}
if (!args.SequenceEqual(["--native-stdio"]))
{
    Console.Error.WriteLine("Launch this coordinator through the installed native menu application.");
    Environment.ExitCode = 2; return;
}
try
{
    var line = await Console.In.ReadLineAsync() ?? throw new InvalidDataException("BOOTSTRAP_REQUIRED");
    if (line.Length > 8192) throw new InvalidDataException("BOOTSTRAP_TOO_LARGE");
    var bootstrap = JsonSerializer.Deserialize<Bootstrap>(line, Wire.Json) ?? throw new InvalidDataException("BAD_BOOTSTRAP");
    var origin = PublicScene.ValidateOrigin(bootstrap.Origin);
    using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromSeconds(10) };
    var token = bootstrap.DeviceToken;
    if (string.IsNullOrEmpty(token))
    {
        if (string.IsNullOrEmpty(bootstrap.PairingCode)) throw new InvalidDataException("PAIRING_REQUIRED");
        var paired = await new AgentClient(http, origin).Pair(new(bootstrap.PairingCode, bootstrap.Name, bootstrap.Platform, version, Environment.OSVersion.Version.ToString()), CancellationToken.None);
        if (paired.ProtocolVersion != 1 || paired.DeviceToken.Length is < 20 or > 4096) throw new InvalidDataException("BAD_PAIR_RESPONSE");
        token = paired.DeviceToken;
        // Anonymous pipe to the native host, which stores the token in Keychain/DPAPI. Never log it.
        Console.WriteLine(JsonSerializer.Serialize(new { id = "pair", type = "PAIR_RESULT", deviceToken = token, deviceId = paired.DeviceId }, Wire.Json));
    }
    var host = new StdioHost();
    await new AgentRuntime(new AgentClient(http, origin, token), origin, host, version).Run(CancellationToken.None);
}
catch (Exception ex)
{
    // Error messages from HTTP and OS APIs may contain paths. Return a stable nonsecret code only.
    Console.Error.WriteLine(ex is InvalidDataException ? ex.Message : "COORDINATOR_FAILED");
    Environment.ExitCode = 1;
}

internal sealed record Bootstrap(string Origin, string Name, string Platform, string? DeviceToken = null, string? PairingCode = null);
internal sealed class StdioHost : IProjectionHost
{
    private readonly SemaphoreSlim gate = new(1);
    public async Task<HostResult> Execute(HostAction action, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(action, Wire.Json));
            var timeout = action.Type is "PREPARE_DISPLAYS" or "RESTORE_DISPLAYS" ? 120 : 15;
            var line = await Console.In.ReadLineAsync(ct).AsTask().WaitAsync(TimeSpan.FromSeconds(timeout), ct) ?? throw new InvalidDataException("NATIVE_HOST_CLOSED");
            if (line.Length > 65_536) throw new InvalidDataException("NATIVE_REPLY_TOO_LARGE");
            var result = JsonSerializer.Deserialize<HostResult>(line, Wire.Json) ?? throw new InvalidDataException("BAD_NATIVE_REPLY");
            if (result.Id != action.Id) throw new InvalidDataException("NATIVE_REPLY_MISMATCH");
            return result;
        }
        finally { gate.Release(); }
    }
}
