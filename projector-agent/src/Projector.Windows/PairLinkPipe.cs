using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using Lecturer.Projector;

namespace Lecturer.Projector.Windows;

internal sealed class PairLinkPipe : IDisposable
{
    private readonly CancellationTokenSource stopped = new();
    private static string Name => "LecturerAssistantProjectorPair-" + WindowsIdentity.GetCurrent().User?.Value;

    public PairLinkPipe(Action<PairLink> receive, string? fixtureChannel = null)
    {
        var channel = fixtureChannel ?? Name;
        var ct = stopped.Token;
        // Pipe reads must not depend on the window thread that may be sending a link.
        _ = Task.Run(() => Listen(receive, channel, ct));
    }

    public static bool Forward(string link, string? fixtureChannel = null)
    {
        _ = PairLink.Parse(link);
        try
        {
            using var pipe = new NamedPipeClientStream(".", fixtureChannel ?? Name, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            pipe.Connect(2000);
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true);
            writer.WriteLine(link); writer.Flush(); return true;
        }
        catch (Exception ex) when (ex is IOException or TimeoutException or UnauthorizedAccessException) { return false; }
    }

    private static async Task ReadLink(NamedPipeServerStream pipe, Action<PairLink> receive, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(3));
        var bytes = new byte[2049]; var used = 0;
        while (used < bytes.Length)
        {
            var read = await pipe.ReadAsync(bytes.AsMemory(used), timeout.Token);
            if (read == 0) break;
            var newline = Array.IndexOf(bytes, (byte)'\n', used, read); used += read;
            if (newline >= 0) { receive(PairLink.Parse(Encoding.UTF8.GetString(bytes, 0, newline).TrimEnd('\r'))); return; }
        }
        throw new InvalidDataException("INVALID_PAIR_LINK");
    }

    private static async Task Listen(Action<PairLink> receive, string channel, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(channel, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(ct); await ReadLink(pipe, receive, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception ex) when (ex is IOException or OperationCanceledException or InvalidDataException or UnauthorizedAccessException) { }
        }
    }

    public void Dispose() { stopped.Cancel(); stopped.Dispose(); }
}
