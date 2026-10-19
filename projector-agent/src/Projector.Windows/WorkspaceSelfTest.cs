using System.Text.Json;
using Lecturer.Projector;

namespace Lecturer.Projector.Windows;

internal static class WorkspaceSelfTest
{
    public static int Run(string path)
    {
        if (!Path.IsPathFullyQualified(path) || File.Exists(path)) return 1;
        var origin = new Uri("https://remote.fixture.invalid/");
        var identifier = "00000000-0000-4000-8000-000000000001";
        var scene = new Uri(origin, "#/helper/remote?courseId=" + identifier + "&sessionId=" + identifier + "&controlToken=" + identifier + "." + new string('a', 64));
        var checks = new List<string>(); var success = false; string? error = null; CaptureExclusion? exclusion = null;
        var gate = new object(); var stage = "starting"; var written = false;
        var progressPath = Path.ChangeExtension(path, ".progress.json");
        void Stage(string next)
        {
            lock (gate)
            {
                stage = next;
                File.WriteAllText(progressPath, JsonSerializer.Serialize(new { mode = "WORKSPACE_PROGRESS", stage, checks = checks.ToArray(), utc = DateTimeOffset.UtcNow }, Wire.Json));
            }
        }
        void Passed(string name) { lock (gate) checks.Add(name); Stage(name); }
        void Result(bool passed, string? failure)
        {
            lock (gate)
            {
                if (written) return; written = true;
                using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                JsonSerializer.Serialize(output, new { mode = "WORKSPACE_SELF_TEST", version = ReleaseInfo.Version, success = passed, checks = checks.ToArray(), error = failure, stage,
                    captureExclusion = exclusion, captureContentVerified = false, captureContentVerification = "REQUIRES_USER_PICKER_AND_INTERACTIVE_CAPTURE",
                    displayMutation = false, startupChanged = false, pairingChanged = false, externalContentRequested = false }, Wire.Json);
            }
        }
        Stage("initializing window");
        using var watchdog = new System.Threading.Timer(_ => {
            try { Result(false, "WORKSPACE_WATCHDOG_TIMEOUT"); }
            finally { Environment.Exit(1); } // Only this explicitly launched, isolated fixture process.
        }, null, TimeSpan.FromSeconds(90), Timeout.InfiniteTimeSpan);
        ApplicationConfiguration.Initialize();
        using var remote = new RemoteForm(origin, scene);
        remote.Shown += async (_, _) => {
            try
            {
                Assert(RemoteForm.AllowedScene(origin, scene), "valid scoped URL");
                Assert(!RemoteForm.AllowedScene(origin, new Uri("https://untrusted.invalid/" + scene.Fragment)), "cross origin rejected");
                Assert(!RemoteForm.AllowedScene(origin, new Uri(origin, scene.Fragment + "&extra=bad")), "extra URL grant rejected");
                Assert(!RemoteForm.AllowedScene(origin, new Uri(origin, "#/courses")), "staff route rejected"); Passed("scoped remote navigation");
                var pair = PairLink.Parse("lecturer-projector://pair?origin=https%3A%2F%2Fremote.fixture.invalid%2F&code=ABCDEF123456");
                Assert(pair.Origin == origin && pair.Code == "ABCDEF123456", "pair link parsed");
                foreach (var invalid in new[] {
                    "lecturer-projector://pair?origin=http%3A%2F%2Fremote.fixture.invalid%2F&code=ABCDEF123456",
                    "lecturer-projector://pair?origin=https%3A%2F%2Fremote.fixture.invalid%2F&code=ABCDEF123456&extra=bad",
                    "lecturer-projector://pair?origin=https%3A%2F%2Fremote.fixture.invalid%2F&code=ABCDEF123456#bad",
                    "lecturer-projector://pair?origin=https%3A%2F%2Fremote.fixture.invalid%2F&code=short" })
                {
                    var rejected = false; try { _ = PairLink.Parse(invalid); } catch (InvalidDataException) { rejected = true; }
                    Assert(rejected, "invalid pair link rejected");
                }
                Passed("strict protocol pairing");
                var received = new TaskCompletionSource<PairLink>(TaskCreationOptions.RunContinuationsAsynchronously);
                var channel = "LecturerProjectorFixture-" + Guid.NewGuid().ToString("N");
                var originalContext = SynchronizationContext.Current;
                var blockedUi = new NoUiDispatchContext(); PairLinkPipe pipe;
                try
                {
                    SynchronizationContext.SetSynchronizationContext(blockedUi);
                    pipe = new PairLinkPipe(link => received.TrySetResult(link), channel);
                }
                finally { SynchronizationContext.SetSynchronizationContext(originalContext); }
                using (pipe)
                {
                    Stage("sending current user pairing link");
                    Assert(await Task.Run(() => PairLinkPipe.Forward("lecturer-projector://pair?origin=https%3A%2F%2Fremote.fixture.invalid%2F&code=ABCDEF123456", channel)).WaitAsync(TimeSpan.FromSeconds(5)), "current user pairing handoff sent");
                    Stage("receiving current user pairing link");
                    Assert((await received.Task.WaitAsync(TimeSpan.FromSeconds(5))).Code == pair.Code, "current user pairing handoff received");
                    Assert(blockedUi.Posts == 0, "pairing I/O does not depend on UI dispatch");
                }
                Passed("current user named pipe delivery");
                Assert(remote.FormBorderStyle == FormBorderStyle.None && !remote.MaximizeBox && remote.WindowState == FormWindowState.Normal, "compact native initial window");
                exclusion = remote.Exclusion;
                if (exclusion.Supported && exclusion.Error != "DESKTOP_COMPOSITION_UNAVAILABLE") Assert(exclusion.Enabled, "capture affinity verified");
                Passed(exclusion.Enabled ? "owned HWND capture exclusion verified by Windows API" : "capture exclusion explicitly unavailable");
                await remote.LoadRemote("<!doctype html><meta charset=utf-8><title>Проверка пульта</title><h2>Пульт</h2><p>Изолированная проверка WebView2</p>", Stage);
                Stage("waiting for local fixture navigation");
                Assert(await remote.Ready.WaitAsync(TimeSpan.FromSeconds(30)), "WebView2 fixture loaded");
                Stage("reading native bridge");
                var bridge = await remote.RunFixtureScript("JSON.stringify({platform:window.lectureProjectorNative.platform,nativeCapture:window.lectureProjectorNative.nativeCapture,resize:typeof window.lectureProjectorNative.resize,post:typeof window.lectureProjectorNative.postMessage})");
                Assert(bridge.Contains("WINDOWS", StringComparison.Ordinal) && bridge.Contains("function", StringComparison.Ordinal) && bridge.Contains("false", StringComparison.Ordinal), "real bridge available");
                Stage("collapsing through native bridge");
                await remote.RunFixtureScript("window.lectureProjectorNative.resize({height:60,collapsed:true})");
                await Task.Delay(300); var scale = remote.DeviceDpi / 96d;
                Assert(Math.Abs(remote.ClientSize.Width - 264 * scale) <= 1 && Math.Abs(remote.ClientSize.Height - 60 * scale) <= 1, "native collapsed size"); Passed("real WebView2 to native compact resize");
                Stage("expanding through native bridge");
                remote.WindowState = FormWindowState.Maximized;
                await remote.RunFixtureScript("window.lectureProjectorNative.postMessage({action:'resize',height:351,collapsed:false})");
                await Task.Delay(300);
                Assert(remote.WindowState == FormWindowState.Normal && Math.Abs(remote.ClientSize.Width - 420 * scale) <= 1, "expansion restores normal compact width");
                Assert(remote.Height <= Screen.FromHandle(remote.Handle).WorkingArea.Height, "height bounded to screen"); Passed("expanded content fit without maximization");
                Stage("resizing minimized remote");
                remote.WindowState = FormWindowState.Minimized;
                await remote.RunFixtureScript("window.lectureProjectorNative.resize({height:412,collapsed:false})");
                await Task.Delay(300);
                Assert(remote.WindowState == FormWindowState.Minimized, "incoming content does not restore a minimized remote");
                remote.WindowState = FormWindowState.Normal;
                await Task.Delay(100);
                Assert(Math.Abs(remote.ClientSize.Width - 420 * scale) <= 1 && remote.ClientSize.Height <= Screen.FromHandle(remote.Handle).WorkingArea.Height, "minimized content restores compactly");
                Passed("content updates preserve minimized state");
                success = true;
            }
            catch (Exception ex) { lock (gate) error = (ex is InvalidDataException ? ex.Message : ex.GetType().Name) + " at " + stage; }
            finally { Stage("closing fixture window"); remote.Close(); }
        };
        Application.Run(remote);
        watchdog.Change(Timeout.Infinite, Timeout.Infinite);
        Result(success, error);
        return success ? 0 : 1;
    }
    private static void Assert(bool valid, string name) { if (!valid) throw new InvalidDataException("CHECK_FAILED: " + name); }
    private sealed class NoUiDispatchContext : SynchronizationContext
    {
        private int posts;
        public int Posts => Volatile.Read(ref posts);
        public override void Post(SendOrPostCallback callback, object? state) => Interlocked.Increment(ref posts);
    }
}
