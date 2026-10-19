using System.Runtime.InteropServices;
using System.Text.Json;
using Lecturer.Projector;

namespace Lecturer.Projector.Windows;

// Runs only when explicitly requested by CI. The source is its own animated canvas,
// not a desktop, capture picker, camera, or another application's window.
internal static class VideoPublisherSelfTest
{
    internal static int Run(string fixturePath, string reportPath)
    {
        if (!Path.IsPathFullyQualified(fixturePath) || !Path.IsPathFullyQualified(reportPath) ||
            !File.Exists(fixturePath) || File.Exists(reportPath)) return 1;
        var html = File.ReadAllText(fixturePath);
        if (html.Length > 8 * 1024 * 1024) return 1;
        var origin = new Uri("https://remote.fixture.invalid/");
        var identifier = "00000000-0000-4000-8000-000000000001";
        var scene = new Uri(origin, "#/helper/remote?courseId=" + identifier + "&sessionId=" + identifier + "&controlToken=" + identifier + "." + new string('a', 64));
        JsonElement? media = null; string? error = null; var finished = false; var written = false;
        var gate = new object();
        void Result(bool success, bool ownedWindowDisposed)
        {
            lock (gate)
            {
                if (written) return; written = true;
                using var output = new FileStream(reportPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                JsonSerializer.Serialize(output, new {
                    mode = "OWN_VIDEO_PUBLISHER_SELF_TEST", version = ReleaseInfo.Version, success, media, error,
                    ownedWindowDisposed,
                    runtime = new { osArchitecture = RuntimeInformation.OSArchitecture.ToString().ToUpperInvariant(),
                        processArchitecture = RuntimeInformation.ProcessArchitecture.ToString().ToUpperInvariant(),
                        processRunsNatively = RuntimeInformation.OSArchitecture == RuntimeInformation.ProcessArchitecture,
                        browserProcessArchitecture = "NOT_MEASURED", webView2 = ProjectionForm.RuntimeVersion() },
                    nativePickerTested = false, desktopCaptured = false, captureExclusionPixelsVerified = false,
                    userInstallationChanged = false, displayMutation = false, startupChanged = false,
                    pairingChanged = false, externalNetworkUsed = false
                }, Wire.Json);
            }
        }
        using var watchdog = new System.Threading.Timer(_ => {
            try { error = "VIDEO_FIXTURE_WATCHDOG_TIMEOUT"; Result(false, false); }
            finally { Environment.Exit(1); } // Only this explicitly launched fixture process.
        }, null, TimeSpan.FromSeconds(100), Timeout.InfiniteTimeSpan);
        ApplicationConfiguration.Initialize();
        using var remote = new RemoteForm(origin, scene);
        remote.Shown += async (_, _) => {
            try
            {
                await remote.LoadRemote(html);
                if (!await remote.Ready.WaitAsync(TimeSpan.FromSeconds(35))) throw new InvalidDataException("FIXTURE_NAVIGATION_FAILED");
                var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(45);
                while (DateTime.UtcNow < deadline)
                {
                    var raw = await remote.RunFixtureScript("window.videoFixtureResult ?? null");
                    using var document = JsonDocument.Parse(raw);
                    if (document.RootElement.ValueKind == JsonValueKind.Object)
                    {
                        media = document.RootElement.Clone();
                        finished = media.Value.GetProperty("success").GetBoolean();
                        if (!finished) error = "VIDEO_MEDIA_ASSERTION_FAILED";
                        break;
                    }
                    await Task.Delay(100);
                }
                if (media is null) error = "VIDEO_MEDIA_RESULT_TIMEOUT";
            }
            catch (Exception ex) when (ex is not OutOfMemoryException) { error = "VIDEO_HOST_" + ex.GetType().Name; }
            finally { remote.Close(); }
        };
        Application.Run(remote);
        remote.Dispose();
        Result(finished && remote.IsDisposed, remote.IsDisposed);
        return finished && remote.IsDisposed ? 0 : 1;
    }
}
