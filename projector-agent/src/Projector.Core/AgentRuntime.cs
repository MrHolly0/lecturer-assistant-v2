using System.Text.Json;
namespace Lecturer.Projector;

public sealed class AgentRuntime
{
    private readonly AgentClient client;
    private readonly IProjectionHost host;
    private readonly string version;
    private readonly OutputActivityLock? activity;
    private readonly CommandExecutor executor;
    private readonly UpdateHealthReporter? health;
    private readonly AgentUpdates updates;
    private readonly ActiveOutputLease boundedLease;
    private readonly TimeProvider clock;
    public AgentRuntime(AgentClient client, Uri origin, IProjectionHost host, string version, TimeProvider? clock = null)
    {
        this.client = client; this.host = host; this.version = version;
        this.clock = clock ?? TimeProvider.System; boundedLease = new(this.clock);
        activity = OutputActivityLock.FromEnvironment();
        executor = new(origin, host, activity); health = UpdateHealthReporter.FromEnvironment(version); updates = new(version);
    }
    private DateTimeOffset? leaseUntil;
    private readonly SemaphoreSlim execution = new(1);
    public async Task Run(CancellationToken ct)
    {
        using var runtimeCancellation = CancellationTokenSource.CreateLinkedTokenSource(ct);
        ct = runtimeCancellation.Token;
        using var watchdogCancellation = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var timer = WatchLease(watchdogCancellation.Token, runtimeCancellation.Cancel);
        AgentAck? ack = null; string? priorScreens = null;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var delay = 3000;
                try
                {
                    var native = await host.Execute(new(Guid.NewGuid().ToString(), "GET_SCREENS"), ct);
                    var screens = native.Screens ?? [];
                    if (native.LocalStop) await StopLocal(ct);
                    if (native.UpdateHandoffFailed) updates.HandoffFailed();
                    var signature = JsonSerializer.Serialize(screens.OrderBy(s => s.Id), Wire.Json);
                    if (priorScreens is not null && priorScreens != signature)
                    {
                        await execution.WaitAsync(ct);
                        try { executor.TopologyChanged(); await executor.NeutralStop(ct); leaseUntil = null; boundedLease.Clear(); }
                        finally { execution.Release(); }
                    }
                    priorScreens = signature;
                    var poll = await client.Poll(new(version, 1, executor.Status, screens, ack, Environment.OSVersion.Version.ToString()), ct);
                    ack = null;
                    if (poll.ProtocolVersion != 1) throw new InvalidDataException("PROTOCOL_MISMATCH");
                    var receivedTimestamp = clock.GetTimestamp(); var receivedUtc = clock.GetUtcNow();
                    if (!poll.UpdateRequired && Version.TryParse(poll.Policy.MinimumVersion, out var minimum) && Version.TryParse(version, out var actual) && actual >= minimum)
                        health?.SuccessfulAuthenticatedPoll();
                    updates.Observe(poll.Release);
                    delay = Math.Clamp(poll.PollAfterMs, 1000, 30_000);
                    await execution.WaitAsync(ct);
                    try
                    {
                        boundedLease.AuthenticatedPoll(poll.LeaseUntil, receivedTimestamp, receivedUtc);
                        leaseUntil = poll.LeaseUntil;
                        if (poll.MustStop || !poll.Policy.Allowed || poll.LeaseUntil <= DateTimeOffset.UtcNow)
                            await executor.NeutralStop(ct);
                        // One outstanding receipt per poll; server re-delivers the next command only after acknowledgement.
                        if (poll.Commands.Length > 1) throw new InvalidDataException("TOO_MANY_COMMANDS");
                        if (poll.Commands.FirstOrDefault() is { } command)
                        {
                            ack = await executor.Execute(command, poll, screens, DateTimeOffset.UtcNow, ct);
                            if (ack.DiagnosticCode == "PRIMARY_TARGET_REQUIRES_MANUAL_SETUP")
                                await host.Execute(new(Guid.NewGuid().ToString(), "TARGET_HELP"), ct);
                        }
                        if (poll.UpdateRequired || poll.Release is not null)
                            await host.Execute(new(Guid.NewGuid().ToString(), "UPDATE_STATUS", TestCode: poll.UpdateRequired ? "REQUIRED" : "AVAILABLE"), ct);
                        if (updates.IdleHandoff(executor.Status, poll.Policy.MinimumVersion) is { } handoff)
                        {
                            var receipt = await host.Execute(handoff, ct);
                            updates.HandoffAccepted(receipt.Success);
                        }
                    }
                    finally { execution.Release(); }
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidDataException)
                {
                    if (ct.IsCancellationRequested) break;
                    if (ex is HttpRequestException { StatusCode: System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden })
                    {
                        await execution.WaitAsync(ct);
                        try { await executor.NeutralStop(ct); leaseUntil = null; boundedLease.Clear(); }
                        finally { execution.Release(); }
                    }
                    // Lease watcher, independent of HTTP timeout, neutralizes expired showing.
                    delay = 3000;
                }
                await Task.Delay(delay, ct);
            }
        }
        finally
        {
            watchdogCancellation.Cancel();
            try { await timer; } catch (OperationCanceledException) { }
            using var stopTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            try { await executor.NeutralStop(stopTimeout.Token); } catch (Exception) { /* Native parent neutralizes if the coordinator exits. */ }
            if (executor.Status == "IDLE") activity?.Dispose();
        }
    }
    public async Task StopLocal(CancellationToken ct)
    {
        await execution.WaitAsync(ct);
        try { await executor.NeutralStop(ct); leaseUntil = null; boundedLease.Clear(); }
        finally { execution.Release(); }
    }
    private async Task WatchLease(CancellationToken ct, Action requestStop)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(500, ct);
            if (health?.StopRequested() == true) { await executor.NeutralStop(ct); requestStop(); return; }
            await execution.WaitAsync(ct);
            try
            {
                if ((executor.Status is "TESTING" or "SHOWING" or "PAUSED") &&
                    (boundedLease.MustStop(true) || (leaseUntil is not null && leaseUntil <= DateTimeOffset.UtcNow)))
                { await executor.NeutralStop(ct); leaseUntil = null; boundedLease.Clear(); }
            }
            finally { execution.Release(); }
        }
    }
}
