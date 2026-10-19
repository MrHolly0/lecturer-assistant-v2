namespace Lecturer.Projector;

/// <summary>A remote UTC deadline never grants more than 12 monotonic seconds from the last authenticated poll.</summary>
public sealed class ActiveOutputLease(TimeProvider clock)
{
    public static readonly TimeSpan MaximumLifetime = TimeSpan.FromSeconds(12);
    private readonly object gate = new();
    private long renewedAt;
    private TimeSpan lifetime;
    private bool hasLease;
    public void AuthenticatedPoll(DateTimeOffset? deadline) => AuthenticatedPoll(deadline, clock.GetTimestamp(), clock.GetUtcNow());
    public void AuthenticatedPoll(DateTimeOffset? deadline, long receivedAt, DateTimeOffset utcNow)
    {
        lock (gate)
        {
            renewedAt = receivedAt;
            hasLease = deadline is not null && deadline > utcNow;
            var remaining = hasLease ? deadline!.Value - utcNow : TimeSpan.Zero;
            lifetime = remaining > MaximumLifetime ? MaximumLifetime : remaining;
        }
    }
    public void Clear() { lock (gate) { hasLease = false; lifetime = TimeSpan.Zero; } }
    public bool MustStop(bool outputActive)
    {
        if (!outputActive) return false;
        lock (gate) return !hasLease || clock.GetElapsedTime(renewedAt, clock.GetTimestamp()) >= lifetime;
    }
}
