using Lecturer.Projector;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
namespace Lecturer.Projector.Windows;

internal sealed class ProjectionForm : Form
{
    public static bool RuntimeAvailable() => RuntimeVersion() is not null;
    public static string? RuntimeVersion()
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            return string.IsNullOrWhiteSpace(version) ? null : version;
        }
        catch (WebView2RuntimeNotFoundException) { return null; }
        catch (System.Runtime.InteropServices.COMException) { return null; }
        catch (DllNotFoundException) { return null; }
        catch (FileNotFoundException) { return null; }
        catch (BadImageFormatException) { return null; }
    }
    private WebView2? web;
    private readonly Uri origin;
    private readonly string profileRoot = Path.Combine(Path.GetTempPath(), "LecturerProjector", Guid.NewGuid().ToString("N"));
    public ProjectionForm(Screen screen, Uri origin)
    {
        this.origin = origin; FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual;
        Bounds = screen.Bounds; BackColor = Color.FromArgb(17, 17, 17); TopMost = true; ShowInTaskbar = false;
    }
    internal static void CloseOwned(ref ProjectionForm? form)
    {
        var prior = form; form = null;
        if (prior is null) return;
        try { prior.Close(); } finally { prior.Dispose(); }
    }
    public void Neutral(string text = "Показ остановлен")
    {
        if (IsDisposed || Disposing) return;
        web?.CoreWebView2?.Stop(); web?.Dispose(); web = null;
        Controls.Clear(); Controls.Add(new Label { Text = text, ForeColor = Color.White, Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter, Font = new Font(SystemFonts.DefaultFont.FontFamily, 28) });
    }
    public async Task ShowScene(Uri scene)
    {
        if (!PublicScene.Allowed(origin, scene)) throw new InvalidDataException("PUBLIC_URL_REJECTED");
        if (!RuntimeAvailable()) throw new InvalidDataException("WEBVIEW2_RUNTIME_MISSING");
        Neutral("Подключение…");
        var control = new WebView2 { Dock = DockStyle.Fill }; web = control; Controls.Clear(); Controls.Add(control);
        var environment = await CoreWebView2Environment.CreateAsync(null, profileRoot).WaitAsync(TimeSpan.FromSeconds(25));
        if (IsDisposed || !ReferenceEquals(web, control)) throw new InvalidDataException("PROJECTION_OPEN_CANCELLED");
        await control.EnsureCoreWebView2Async(environment).WaitAsync(TimeSpan.FromSeconds(25));
        if (IsDisposed || !ReferenceEquals(web, control)) throw new InvalidDataException("PROJECTION_OPEN_CANCELLED");
        var core = control.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false; core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false; core.Settings.IsStatusBarEnabled = false;
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.DownloadStarting += (_, args) => args.Cancel = true;
        core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        core.ScreenCaptureStarting += (_, args) => { args.Cancel = true; args.Handled = true; };
        core.FrameCreated += (_, args) => args.Frame.ScreenCaptureStarting += (_, request) => { request.Cancel = true; request.Handled = true; };
        core.NavigationStarting += (_, args) => { if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var url) || url != scene) args.Cancel = true; };
        core.SourceChanged += (_, _) => { if (!Uri.TryCreate(core.Source, UriKind.Absolute, out var url) || !PublicScene.Allowed(origin, url)) Neutral(); };
        core.ProcessFailed += (_, _) => Neutral("Связь с показом потеряна");
        core.Navigate(scene.AbsoluteUri);
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { web?.Dispose(); try { Directory.Delete(profileRoot, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
        base.Dispose(disposing);
    }
}
