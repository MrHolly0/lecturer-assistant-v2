using System.Runtime.InteropServices;
using System.Text.Json;
using Lecturer.Projector;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Lecturer.Projector.Windows;

// This is an owned native window: capture exclusion is never applied to another app.
internal sealed class RemoteForm : Form
{
    private readonly Uri origin;
    private readonly Uri scene;
    private readonly Action? focusProjection;
    private readonly Action? stopProjection;
    private string theme;
    private readonly string profileRoot = Path.Combine(Path.GetTempPath(), "LecturerProjectorRemote", Guid.NewGuid().ToString("N"));
    private WebView2? web;
    private bool collapsed;
    private bool disposed;
    private (int Width, int Height, bool Collapsed)? pendingSize;
    private readonly TaskCompletionSource<bool> loaded = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal Task<bool> Ready => loaded.Task;
    internal bool MatchesScene(Uri candidate) => StringComparer.Ordinal.Equals(scene.AbsoluteUri, candidate.AbsoluteUri);
    public CaptureExclusion Exclusion { get; private set; } = new(false, false, "WINDOW_NOT_READY");

    public RemoteForm(Uri origin, Uri scene, Action? focusProjection = null, Action? stopProjection = null, string theme = "light")
    {
        if (!AllowedScene(origin, scene)) throw new InvalidDataException("REMOTE_URL_REJECTED");
        if (theme is not ("light" or "dark")) throw new InvalidDataException("REMOTE_THEME_REJECTED");
        this.origin = origin; this.scene = scene; this.focusProjection = focusProjection; this.stopProjection = stopProjection; this.theme = theme;
        Text = "Lecturer Assistant — пульт"; FormBorderStyle = FormBorderStyle.None;
        AutoScaleMode = AutoScaleMode.None; StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = true; TopMost = true; MaximizeBox = false; MinimizeBox = false;
        WindowState = FormWindowState.Normal; BackColor = ThemeBackground;
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
        ClientSize = new Size(420, 400);
        Location = new Point(area.Right - Width - 24, area.Top + 24);
        HandleCreated += (_, _) => Exclusion = CaptureExclusion.Apply(Handle);
        DpiChanged += (_, _) => ApplyContentSize(collapsed ? 264 : 420, collapsed ? 60 : 400, collapsed);
        Resize += (_, _) => {
            if (WindowState == FormWindowState.Normal && pendingSize is { } size)
            { pendingSize = null; ApplyContentSize(size.Width, size.Height, size.Collapsed); }
        };
        FormClosed += (_, _) => disposed = true;
    }

    public async Task LoadRemote(string? fixtureHtml = null, Action<string>? progress = null)
    {
        if (!ProjectionForm.RuntimeAvailable()) throw new InvalidDataException("WEBVIEW2_RUNTIME_MISSING");
        var control = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = ThemeBackground }; web = control; Controls.Add(control);
        progress?.Invoke("creating WebView2 environment");
        var environment = await CoreWebView2Environment.CreateAsync(null, profileRoot).WaitAsync(TimeSpan.FromSeconds(25));
        environment.BrowserProcessExited += (_, _) => DeleteProfile();
        if (disposed) return;
        var options = environment.CreateCoreWebView2ControllerOptions(); options.IsInPrivateModeEnabled = true;
        progress?.Invoke("creating WebView2 controller");
        await control.EnsureCoreWebView2Async(environment, options).WaitAsync(TimeSpan.FromSeconds(25));
        if (disposed) return;
        var core = control.CoreWebView2;
        ApplyNativeTheme();
        if (fixtureHtml is not null)
        {
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, args) => {
                var allowed = Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var requested) &&
                    requested.GetLeftPart(UriPartial.Path) == origin.AbsoluteUri && requested.Query.Length == 0;
                args.Response = environment.CreateWebResourceResponse(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(allowed ? fixtureHtml : "")),
                    allowed ? 200 : 403, allowed ? "OK" : "Forbidden", "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n");
            };
        }
        core.Settings.AreDevToolsEnabled = false; core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false; core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false; core.Settings.IsGeneralAutofillEnabled = false;
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.DownloadStarting += (_, args) => args.Cancel = true;
        core.PermissionRequested += (_, args) => { args.SavesInProfile = false; args.State = CoreWebView2PermissionState.Deny; };
        // getDisplayMedia has a separate user-mediated picker, not camera/microphone permission.
        // Chromium still requires transient user activation and never persists the choice.
        core.ScreenCaptureStarting += (_, args) => args.Cancel =
            !TrustedDocument(core.Source) || !TrustedDocument(args.OriginalSourceFrameInfo.Source);
        core.FrameCreated += (_, args) => args.Frame.ScreenCaptureStarting += (_, request) => { request.Cancel = true; request.Handled = true; };
        core.NavigationStarting += (_, args) => { if (!TrustedDocument(args.Uri)) args.Cancel = true; };
        core.SourceChanged += (_, _) => { if (!TrustedDocument(core.Source)) Close(); };
        core.WindowCloseRequested += (_, _) => Close();
        core.WebMessageReceived += Receive;
        core.ProcessFailed += (_, _) => Close();
        progress?.Invoke("injecting native bridge");
        await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript()).WaitAsync(TimeSpan.FromSeconds(10));
        core.NavigationCompleted += async (_, args) => { loaded.TrySetResult(args.IsSuccess); SendTheme(); await SendCapabilities(); };
        progress?.Invoke("navigating remote document");
        core.Navigate(scene.AbsoluteUri);
    }
    internal Task<string> RunFixtureScript(string script) => web?.CoreWebView2?.ExecuteScriptAsync(script).WaitAsync(TimeSpan.FromSeconds(10)) ?? throw new InvalidOperationException("REMOTE_NOT_READY");

    private void Receive(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!TrustedDocument(args.Source) || web?.CoreWebView2 is null) return;
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson, new JsonDocumentOptions { MaxDepth = 6 });
            var value = document.RootElement;
            if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("type", out var type) || type.GetString() != "LECTURE_REMOTE" ||
                !value.TryGetProperty("action", out var action)) return;
            switch (action.GetString())
            {
                case "ready": case "capabilities": _ = SendCapabilities(); break;
                case "resize":
                    if (value.TryGetProperty("height", out var height) && height.TryGetInt32(out var requestedHeight))
                    {
                        var isCollapsed = value.TryGetProperty("collapsed", out var state) && state.ValueKind == JsonValueKind.True;
                        ApplyContentSize(isCollapsed ? 264 : 420, requestedHeight, isCollapsed);
                    }
                    break;
                case "drag":
                    // The native move loop must start after WebView2's callback returns.
                    BeginInvoke(() => {
                        if (disposed || IsDisposed || !IsHandleCreated) return;
                        ReleaseCapture(); SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero);
                    });
                    break;
                case "close": Close(); break;
                case "minimize": WindowState = FormWindowState.Minimized; break;
                case "focusProjection": focusProjection?.Invoke(); break;
                case "stopProjection":
                    // Closing the controller must happen after this WebView2 callback returns.
                    BeginInvoke(() => { if (!disposed && !IsDisposed) stopProjection?.Invoke(); });
                    break;
            }
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException) { }
    }

    internal void ApplyContentSize(int width, int height, bool isCollapsed)
    {
        if (disposed) return;
        collapsed = isCollapsed;
        if (WindowState == FormWindowState.Minimized) { pendingSize = (width, height, isCollapsed); return; }
        var scale = DeviceDpi / 96d;
        var area = Screen.FromHandle(Handle).WorkingArea;
        var desired = new Size(Math.Min(area.Width, (int)Math.Ceiling((isCollapsed ? 264 : Math.Clamp(width, 320, 480)) * scale)),
            Math.Min(Math.Max(60, area.Height - 24), (int)Math.Ceiling(Math.Clamp(height, isCollapsed ? 60 : 160, isCollapsed ? 60 : 780) * scale)));
        // Ignore a remembered maximize state and clamp after resolution/DPI changes.
        WindowState = FormWindowState.Normal; ClientSize = desired;
        Location = new Point(Math.Clamp(Left, area.Left, Math.Max(area.Left, area.Right - Width)),
            Math.Clamp(Top, area.Top, Math.Max(area.Top, area.Bottom - Height)));
    }

    private bool TrustedDocument(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme == origin.Scheme && uri.Authority == origin.Authority && uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" &&
        uri.Query.Length == 0 && (StringComparer.Ordinal.Equals(uri.AbsoluteUri, scene.AbsoluteUri) || uri.Fragment == "#/helper/remote");

    internal static bool AllowedScene(Uri origin, Uri candidate) =>
        origin.Scheme == "https" && LectureWorkspace.Allowed(origin, candidate);

    private Color ThemeBackground => theme == "dark" ? Color.FromArgb(17, 24, 39) : Color.White;
    internal void SetTheme(string value)
    {
        if (value is not ("light" or "dark")) throw new InvalidDataException("REMOTE_THEME_REJECTED");
        if (disposed || theme == value) return;
        theme = value; BackColor = ThemeBackground; ApplyNativeTheme(); SendTheme();
    }
    private void ApplyNativeTheme()
    {
        if (disposed || web?.CoreWebView2 is null) return;
        web.DefaultBackgroundColor = ThemeBackground;
        web.CoreWebView2.Profile.PreferredColorScheme = theme == "dark" ? CoreWebView2PreferredColorScheme.Dark : CoreWebView2PreferredColorScheme.Light;
    }
    private void SendTheme()
    {
        if (disposed || web?.CoreWebView2 is null) return;
        try { web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "LECTURE_PROJECTOR_THEME", theme }, Wire.Json)); }
        catch (InvalidOperationException) { }
    }

    private string BridgeScript()
    {
        var capabilities = JsonSerializer.Serialize(new { platform = "WINDOWS", nativeCapture = false, captureExclusion = Exclusion,
            capture = "webview2-user-picker", theme, version = ReleaseInfo.Version }, Wire.Json);
        return """
            (() => {
              if (window.top !== window) return;
              const capabilities = __NATIVE_CAPABILITIES_JSON__;
              let theme = capabilities.theme;
              const applyTheme = (next) => {
                if (next !== 'light' && next !== 'dark') return;
                theme = next;
                try { localStorage.setItem('la_theme_preference', theme); } catch {}
                const root = document.documentElement;
                if (root) {
                  root.dataset.appTheme = theme;
                  root.style.colorScheme = theme;
                  root.classList.toggle('dark', theme === 'dark');
                }
              };
              applyTheme(theme);
              const post = (action, extra = {}) => window.chrome.webview.postMessage({type:'LECTURE_REMOTE', action, ...extra});
              const bridge = Object.freeze({
                ...capabilities, get theme() { return theme; },
                postMessage: (message) => window.chrome.webview.postMessage({...message, type:'LECTURE_REMOTE'}),
                resize: ({width = 420, height = 400, collapsed = false} = {}) => post('resize', {width, height, collapsed}),
                drag: () => post('drag'), close: () => post('close'), minimize: () => post('minimize'),
                focusProjection: () => post('focusProjection'),
                stopProjection: () => post('stopProjection'),
                capabilities: () => post('capabilities')
              });
              Object.defineProperty(window, 'lectureProjectorNative', {value: bridge, configurable: false, writable: false});
              window.chrome.webview.addEventListener('message', ({data}) => {
                if (data?.type === 'LECTURE_PROJECTOR_THEME' && (data.theme === 'light' || data.theme === 'dark')) {
                  applyTheme(data.theme);
                  window.dispatchEvent(new CustomEvent('lecture-projector-theme', {detail: {theme}}));
                }
                if (data?.type === 'LECTURE_NATIVE_CAPABILITIES')
                  window.dispatchEvent(new CustomEvent('lecture-projector-native', {detail: data}));
              });
            })();
            """.Replace("__NATIVE_CAPABILITIES_JSON__", capabilities, StringComparison.Ordinal);
    }

    private async Task SendCapabilities()
    {
        if (disposed || web?.CoreWebView2 is null) return;
        Exclusion = CaptureExclusion.Apply(Handle);
        try { web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "LECTURE_NATIVE_CAPABILITIES", platform = "WINDOWS", nativeCapture = false,
            captureExclusion = Exclusion, theme, version = ReleaseInfo.Version }, Wire.Json)); }
        catch (InvalidOperationException) { }
        await Task.CompletedTask;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { disposed = true; web?.Dispose(); DeleteProfile(); }
        base.Dispose(disposing);
    }
    private void DeleteProfile()
    {
        try { Directory.Delete(profileRoot, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
}
