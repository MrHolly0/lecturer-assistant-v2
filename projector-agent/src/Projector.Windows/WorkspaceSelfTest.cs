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
        ApplicationConfiguration.Initialize();
        using var remote = new RemoteForm(origin, scene);
        remote.Shown += async (_, _) => {
            try
            {
                Assert(RemoteForm.AllowedScene(origin, scene), "valid scoped URL");
                Assert(!RemoteForm.AllowedScene(origin, new Uri("https://untrusted.invalid/" + scene.Fragment)), "cross origin rejected");
                Assert(!RemoteForm.AllowedScene(origin, new Uri(origin, scene.Fragment + "&extra=bad")), "extra URL grant rejected");
                Assert(!RemoteForm.AllowedScene(origin, new Uri(origin, "#/courses")), "staff route rejected"); checks.Add("scoped remote navigation");
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
                checks.Add("strict protocol pairing");
                var received = new TaskCompletionSource<PairLink>(TaskCreationOptions.RunContinuationsAsynchronously);
                var channel = "LecturerProjectorFixture-" + Guid.NewGuid().ToString("N");
                using (var pipe = new PairLinkPipe(link => received.TrySetResult(link), channel))
                {
                    Assert(PairLinkPipe.Forward("lecturer-projector://pair?origin=https%3A%2F%2Fremote.fixture.invalid%2F&code=ABCDEF123456", channel), "current user pairing handoff sent");
                    Assert((await received.Task.WaitAsync(TimeSpan.FromSeconds(5))).Code == pair.Code, "current user pairing handoff received");
                }
                checks.Add("current user named pipe delivery");
                Assert(remote.FormBorderStyle == FormBorderStyle.None && !remote.MaximizeBox && remote.WindowState == FormWindowState.Normal, "compact native initial window");
                exclusion = remote.Exclusion;
                if (exclusion.Supported && exclusion.Error != "DESKTOP_COMPOSITION_UNAVAILABLE") Assert(exclusion.Enabled, "capture affinity verified");
                checks.Add(exclusion.Enabled ? "owned HWND capture exclusion verified by Windows API" : "capture exclusion explicitly unavailable");
                await remote.LoadRemote("<!doctype html><meta charset=utf-8><title>Проверка пульта</title><h2>Пульт</h2><p>Изолированная проверка WebView2</p>");
                Assert(await remote.Ready.WaitAsync(TimeSpan.FromSeconds(30)), "WebView2 fixture loaded");
                var bridge = await remote.RunFixtureScript("JSON.stringify({platform:window.lectureProjectorNative.platform,nativeCapture:window.lectureProjectorNative.nativeCapture,resize:typeof window.lectureProjectorNative.resize,post:typeof window.lectureProjectorNative.postMessage})");
                Assert(bridge.Contains("WINDOWS", StringComparison.Ordinal) && bridge.Contains("function", StringComparison.Ordinal) && bridge.Contains("false", StringComparison.Ordinal), "real bridge available");
                await remote.RunFixtureScript("window.lectureProjectorNative.resize({height:60,collapsed:true})");
                await Task.Delay(300); var scale = remote.DeviceDpi / 96d;
                Assert(Math.Abs(remote.ClientSize.Width - 264 * scale) <= 1 && Math.Abs(remote.ClientSize.Height - 60 * scale) <= 1, "native collapsed size"); checks.Add("real WebView2 to native compact resize");
                remote.WindowState = FormWindowState.Maximized;
                await remote.RunFixtureScript("window.lectureProjectorNative.postMessage({action:'resize',height:351,collapsed:false})");
                await Task.Delay(300);
                Assert(remote.WindowState == FormWindowState.Normal && Math.Abs(remote.ClientSize.Width - 420 * scale) <= 1, "expansion restores normal compact width");
                Assert(remote.Height <= Screen.FromHandle(remote.Handle).WorkingArea.Height, "height bounded to screen"); checks.Add("expanded content fit without maximization");
                remote.WindowState = FormWindowState.Minimized;
                await remote.RunFixtureScript("window.lectureProjectorNative.resize({height:412,collapsed:false})");
                await Task.Delay(300);
                Assert(remote.WindowState == FormWindowState.Minimized, "incoming content does not restore a minimized remote");
                remote.WindowState = FormWindowState.Normal;
                await Task.Delay(100);
                Assert(Math.Abs(remote.ClientSize.Width - 420 * scale) <= 1 && remote.ClientSize.Height <= Screen.FromHandle(remote.Handle).WorkingArea.Height, "minimized content restores compactly");
                checks.Add("content updates preserve minimized state");
                success = true;
            }
            catch (Exception ex) { error = ex is InvalidDataException ? ex.Message : ex.GetType().Name; }
            finally { remote.Close(); }
        };
        Application.Run(remote);
        using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        JsonSerializer.Serialize(output, new { mode = "WORKSPACE_SELF_TEST", version = ReleaseInfo.Version, success, checks, error,
            captureExclusion = exclusion, captureContentVerified = false, captureContentVerification = "REQUIRES_USER_PICKER_AND_INTERACTIVE_CAPTURE",
            displayMutation = false, startupChanged = false, pairingChanged = false, externalContentRequested = false }, Wire.Json);
        return success ? 0 : 1;
    }
    private static void Assert(bool valid, string name) { if (!valid) throw new InvalidDataException("CHECK_FAILED: " + name); }
}
