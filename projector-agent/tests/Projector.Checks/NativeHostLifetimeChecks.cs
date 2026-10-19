using System.Net;
using System.Text.Json;
using System.Threading.Channels;
using Lecturer.Projector;

internal static class NativeHostLifetimeChecks
{
    public static int Run()
    {
        if (Environment.GetEnvironmentVariable("LA_PROJECTOR_INSTALL_ROOT") is not null)
            throw new InvalidOperationException("LIFETIME_FIXTURE_REQUIRES_ISOLATED_ENVIRONMENT");
        var passed = 0;
        void Check(string name, Func<Task> body) { body().GetAwaiter().GetResult(); Console.WriteLine("PASS " + name); passed++; }
        Check("stdio reply correlation and EOF while idle end the transport", async () => {
            var input = new FixtureReader(); var output = new FixtureWriter();
            using var host = new StdioProjectionHost(input, output);
            var response = host.Execute(new("one", "GET_SCREENS"), CancellationToken.None);
            var request = JsonSerializer.Deserialize<HostAction>(await output.Next(), Wire.Json)!;
            Require(request.Id == "one" && request.Type == "GET_SCREENS");
            input.Send(JsonSerializer.Serialize(new HostResult("one", true, Screens: []), Wire.Json));
            Require((await response.WaitAsync(TimeSpan.FromSeconds(2))).Success);
            input.End(); await WaitClosed(host.Closed);
            await ExpectClosed(host.Execute(new("two", "GET_SCREENS"), CancellationToken.None));
            Require(output.Count == 1);
        });
        Check("stdio EOF before the first action never writes a request", async () => {
            var input = new FixtureReader(); var output = new FixtureWriter();
            using var host = new StdioProjectionHost(input, output);
            input.End(); await WaitClosed(host.Closed);
            await ExpectClosed(host.Execute(new("one", "GET_SCREENS"), CancellationToken.None));
            Require(output.Count == 0);
        });
        Check("native host EOF terminates runtime before any authenticated poll", async () => {
            using var host = new FixtureHost();
            host.ExecuteAction = (_, _) => { host.End(); throw new NativeHostClosedException(); };
            using var handler = new FixtureHttp((_, _) => throw new InvalidOperationException("UNEXPECTED_POLL"));
            using var http = new HttpClient(handler);
            await ExpectClosed(new AgentRuntime(new(http, new("https://fixture.invalid/"), "fixture"), new("https://fixture.invalid/"), host, "0.2.8").Run(CancellationToken.None));
            Require(handler.Calls == 0 && host.Actions.Count == 1);
        });
        Check("native host EOF cancels an in-flight authenticated poll without retry", async () => {
            using var host = new FixtureHost();
            var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var cancelled = false;
            using var handler = new FixtureHttp(async (_, ct) => {
                entered.TrySetResult();
                try { await Task.Delay(Timeout.Infinite, ct); }
                catch (OperationCanceledException) { cancelled = true; throw; }
                throw new InvalidOperationException("POLL_NOT_CANCELLED");
            });
            using var http = new HttpClient(handler);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(4));
            var running = new AgentRuntime(new(http, new("https://fixture.invalid/"), "fixture"), new("https://fixture.invalid/"), host, "0.2.8").Run(deadline.Token);
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(2)); host.End();
            await ExpectClosed(running);
            Require(cancelled && handler.Calls == 1 && host.Actions.Count == 1);
        });
        Check("native EOF during a command is never converted into an acknowledgement", async () => {
            using var host = new FixtureHost();
            host.ExecuteAction = (action, _) => {
                if (action.Type == "TEST_TARGET") { host.End(); throw new NativeHostClosedException(); }
                return Task.FromResult(new HostResult(action.Id, true, Screens: [new("external", "Fixture", 1280, 720, false)]));
            };
            var poll = new PollResponse(1, 1000, DateTimeOffset.UtcNow.AddSeconds(30), false, new(true, "0.1.0"), false, null,
                [new(Guid.NewGuid(), "TEST_TARGET", DateTimeOffset.UtcNow.AddSeconds(20), new(TargetScreenId: "external", TestCode: "ABCDEF"))]);
            using var handler = new FixtureHttp((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(poll, Wire.Json)) }));
            using var http = new HttpClient(handler);
            await ExpectClosed(new AgentRuntime(new(http, new("https://fixture.invalid/"), "fixture"), new("https://fixture.invalid/"), host, "0.2.8").Run(CancellationToken.None));
            Require(handler.Calls == 1 && host.Actions.Select(a => a.Type).SequenceEqual(["GET_SCREENS", "TEST_TARGET"]));
        });
        Check("legacy NATIVE_HOST_CLOSED is fatal rather than a poll-loop retry", async () => {
            using var host = new FixtureHost();
            host.ExecuteAction = (action, _) => action.Type == "GET_SCREENS"
                ? throw new InvalidDataException("NATIVE_HOST_CLOSED")
                : Task.FromResult(new HostResult(action.Id, true));
            using var handler = new FixtureHttp((_, _) => throw new InvalidOperationException("UNEXPECTED_POLL"));
            using var http = new HttpClient(handler);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(4));
            try { await ExpectClosed(new AgentRuntime(new(http, new("https://fixture.invalid/"), "fixture"), new("https://fixture.invalid/"), host, "0.2.8").Run(deadline.Token)); }
            finally { deadline.Cancel(); }
            Require(handler.Calls == 0 && host.Actions.Count(a => a.Type == "GET_SCREENS") == 1);
        });
        return passed;
    }

    private static async Task WaitClosed(CancellationToken token)
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var registration = token.Register(() => done.TrySetResult());
        await done.Task.WaitAsync(TimeSpan.FromSeconds(2));
    }
    private static async Task ExpectClosed(Task task)
    {
        try { await task.WaitAsync(TimeSpan.FromSeconds(2)); }
        catch (NativeHostClosedException) { return; }
        throw new InvalidOperationException("EXPECTED_FATAL_NATIVE_HOST_CLOSED");
    }
    private static void Require(bool value) { if (!value) throw new InvalidOperationException("LIFETIME_FIXTURE_ASSERTION_FAILED"); }
    private sealed class FixtureReader : TextReader
    {
        private readonly Channel<string> lines = Channel.CreateUnbounded<string>();
        public void Send(string line) => lines.Writer.TryWrite(line);
        public void End() => lines.Writer.TryComplete();
        public override async ValueTask<string?> ReadLineAsync(CancellationToken ct)
        {
            try { return await lines.Reader.ReadAsync(ct); }
            catch (ChannelClosedException) { return null; }
        }
    }
    private sealed class FixtureWriter : TextWriter
    {
        private readonly Channel<string> lines = Channel.CreateUnbounded<string>();
        public int Count { get; private set; }
        public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;
        public override Task WriteLineAsync(ReadOnlyMemory<char> line, CancellationToken ct = default)
        { Count++; lines.Writer.TryWrite(line.ToString()); return Task.CompletedTask; }
        public Task<string> Next() => lines.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
    }
    private sealed class FixtureHost : IProjectionHost, IDisposable
    {
        private readonly CancellationTokenSource closed = new();
        public CancellationToken Closed => closed.Token;
        public List<HostAction> Actions { get; } = [];
        public Func<HostAction, CancellationToken, Task<HostResult>> ExecuteAction { get; set; } = (action, _) => Task.FromResult(new HostResult(action.Id, true, Screens: []));
        public void End() => closed.Cancel();
        public Task<HostResult> Execute(HostAction action, CancellationToken ct) { Actions.Add(action); return ExecuteAction(action, ct); }
        public void Dispose() => closed.Dispose();
    }
    private sealed class FixtureHttp(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> handler) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        { Calls++; return handler(request, ct); }
    }
}
