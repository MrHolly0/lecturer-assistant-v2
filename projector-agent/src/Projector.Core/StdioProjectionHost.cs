using System.Text.Json;
using System.Threading.Channels;

namespace Lecturer.Projector;

public sealed class NativeHostClosedException : IOException
{
    public NativeHostClosedException() : base("NATIVE_HOST_CLOSED") { }
}

public sealed class StdioProjectionHost : IProjectionHost, IDisposable
{
    private readonly TextReader input;
    private readonly TextWriter output;
    private readonly SemaphoreSlim gate = new(1);
    private readonly CancellationTokenSource closed = new();
    private readonly Channel<string> replies = Channel.CreateBounded<string>(1);
    public CancellationToken Closed => closed.Token;

    public StdioProjectionHost(TextReader input, TextWriter output)
    {
        this.input = input; this.output = output;
        // Console.In may perform a blocking read. Never block the runtime or UI thread.
        _ = Task.Run(ReadReplies);
    }

    private async Task ReadReplies()
    {
        try
        {
            while (!closed.IsCancellationRequested)
            {
                var line = await input.ReadLineAsync(closed.Token);
                if (line is null || line.Length > 65_536 || !replies.Writer.TryWrite(line)) break;
            }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or OperationCanceledException) { }
        finally { Disconnect(); }
    }

    public async Task<HostResult> Execute(HostAction action, CancellationToken ct)
    {
        using var request = CancellationTokenSource.CreateLinkedTokenSource(ct, Closed);
        try
        {
            await gate.WaitAsync(request.Token);
            try
            {
                Closed.ThrowIfCancellationRequested();
                await output.WriteLineAsync(JsonSerializer.Serialize(action, Wire.Json).AsMemory(), request.Token);
                await output.FlushAsync(request.Token);
                var seconds = action.Type is "PREPARE_DISPLAYS" or "RESTORE_DISPLAYS" ? 120 : 15;
                var line = await replies.Reader.ReadAsync(request.Token).AsTask().WaitAsync(TimeSpan.FromSeconds(seconds), request.Token);
                var result = JsonSerializer.Deserialize<HostResult>(line, Wire.Json) ?? throw new InvalidDataException("BAD_NATIVE_REPLY");
                if (result.Id != action.Id) throw new InvalidDataException("NATIVE_REPLY_MISMATCH");
                return result;
            }
            finally { gate.Release(); }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or ChannelClosedException || Closed.IsCancellationRequested)
        {
            Disconnect();
            throw new NativeHostClosedException();
        }
    }

    private void Disconnect()
    {
        closed.Cancel();
        replies.Writer.TryComplete();
    }

    public void Dispose() => Disconnect();
}
