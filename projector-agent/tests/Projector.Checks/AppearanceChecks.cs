using System.Net;
using System.Text;
using System.Text.Json;
using Lecturer.Projector;

internal static class AppearanceChecks
{
    public static int Run()
    {
        const string oldPacket = "{\"protocolVersion\":1,\"pollAfterMs\":1000,\"mustStop\":false,\"policy\":{\"allowed\":true,\"minimumVersion\":\"0.1.0\"},\"updateRequired\":false,\"commands\":[]}";
        if (JsonSerializer.Deserialize<PollResponse>(oldPacket, Wire.Json)?.RemoteTheme is not null)
            throw new Exception("Old poll must retain the native theme");
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var handler = new ThemePolls(cancellation);
        using var http = new HttpClient(handler);
        var host = new FakeHost();
        var origin = new Uri("https://lecture.example/");
        new AgentRuntime(new AgentClient(http, origin), origin, host, "0.2.4").Run(cancellation.Token).GetAwaiter().GetResult();
        var themes = host.Actions.Where(action => action.Type == "SET_THEME").ToArray();
        if (themes.Length != 2 || themes[0].Theme != "dark" || themes[1].Theme != "light")
            throw new Exception("Theme polling must ignore null/invalid values and deduplicate unchanged state");
        var focus = host.Actions.FindIndex(action => action.Type == "FOCUS_PRIVATE_REMOTE");
        if (focus < 0 || focus <= host.Actions.FindIndex(action => action.Type == "SET_THEME" && action.Theme == "light"))
            throw new Exception("Current theme must reach the host before its remote opens");
        Console.WriteLine("PASS optional theme wire compatibility; native poll applies changed theme before focus without reopening");
        return 1;
    }

    private sealed class ThemePolls(CancellationTokenSource cancellation) : HttpMessageHandler
    {
        private int polls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var step = ++polls;
            if (step == 6) { cancellation.Cancel(); return Task.FromCanceled<HttpResponseMessage>(cancellation.Token); }
            var token = "20000000-0000-4000-8000-000000000003." + new string('b', 64);
            AgentCommand[] commands = step == 4 ? [new(Guid.NewGuid(), "FOCUS_PRIVATE_REMOTE", DateTimeOffset.UtcNow.AddMinutes(1),
                new(ControlToken: token, CourseId: Guid.NewGuid(), SessionId: Guid.NewGuid()))] : [];
            var packet = new PollResponse(1, 1000, DateTimeOffset.UtcNow.AddSeconds(12), false, new(true, "0.1.0"), false, null,
                commands, step switch { 2 or 3 => "dark", 4 => "light", 5 => "invalid", _ => null });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(packet, Wire.Json), Encoding.UTF8, "application/json") });
        }
    }
}
