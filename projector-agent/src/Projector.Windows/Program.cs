using System.Runtime.InteropServices;
using System.Text.Json;
using System.Diagnostics;
using Lecturer.Projector;
using Microsoft.Win32;

namespace Lecturer.Projector.Windows;
internal static class Program
{
    [STAThread] private static int Main(string[] args)
    {
        if (args.Length > 0) return Preflight(args);
        using var singleton = new Mutex(true, "Local\\LecturerAssistantProjector", out var first);
        if (!first) return 0;
        foreach (var maintenanceName in new[] { "Local\\LecturerAssistantProjectorSetup", "Local\\LecturerAssistantProjectorMaintenance" })
        {
            if (Mutex.TryOpenExisting(maintenanceName, out var maintenance)) { maintenance.Dispose(); return 0; }
        }
        ApplicationConfiguration.Initialize(); Application.Run(new TrayApplication());
        return 0;
    }
    private static int Preflight(string[] args)
    {
        if (args.Length != 2 || args[0] != "--preflight" || !Path.IsPathFullyQualified(args[1])) return 1;
        try
        {
            var runtime = ProjectionForm.RuntimeVersion();
            var report = new
            {
                mode = "PREFLIGHT",
                version = ReleaseInfo.Version,
                operatingSystem = RuntimeInformation.OSDescription,
                osVersion = Environment.OSVersion.Version.ToString(),
                osArchitecture = RuntimeInformation.OSArchitecture.ToString().ToUpperInvariant(),
                processArchitecture = RuntimeInformation.ProcessArchitecture.ToString().ToUpperInvariant(),
                platform = "WINDOWS_" + RuntimeInformation.ProcessArchitecture.ToString().ToUpperInvariant(),
                framework = RuntimeInformation.FrameworkDescription,
                webView2 = new { status = runtime is null ? "MISSING_OR_UNAVAILABLE" : "AVAILABLE", version = runtime },
                displayMutation = false,
                startupChanged = false,
                uiOpened = false,
                networkRequested = false,
                pairingChanged = false
            };
            // The only preflight write is the explicitly requested, previously absent report.
            using var output = new FileStream(args[1], FileMode.CreateNew, FileAccess.Write, FileShare.None);
            JsonSerializer.Serialize(output, report, Wire.Json);
            return 0;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException) { return 1; }
    }
}
internal sealed class TrayApplication : ApplicationContext, IProjectionHost
{
    private readonly Form dispatcher = new() { ShowInTaskbar = false };
    private readonly NotifyIcon tray;
    private readonly string directory;
    private readonly NativeDisplays display;
    private ProjectionForm? projection;
    private Uri? origin;
    private CancellationTokenSource? cancellation;
    private string status = "Не подключён";
    private long generation;
    private bool pendingLocalStop;
    private bool pendingUpdateHandoffFailed;
    private PendingNativeUpdate? pendingUpdate;
    private readonly System.Windows.Forms.Timer updateStopTimer = new() { Interval = 500 };
    private readonly UpdateHealthReporter? updateHealth = UpdateHealthReporter.FromEnvironment(ReleaseInfo.Version);
    private const string StartupName = "LecturerAssistantProjector";
    public TrayApplication()
    {
        directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LecturerProjector");
        Directory.CreateDirectory(directory); display = new(directory);
        updateStopTimer.Tick += (_, _) => {
            if (pendingUpdate is { } update)
            {
                if (update.Ready) { update.Dispose(); pendingUpdate = null; Stop(); ExitThread(); return; }
                if (update.Failed) { update.Dispose(); pendingUpdate = null; pendingUpdateHandoffFailed = true; status = "Подготовка обновления не удалась — помощник продолжает работать"; UpdateMenu(); }
            }
            if (updateHealth?.StopRequested() == true) { Stop(); ExitThread(); }
        }; updateStopTimer.Start(); _ = dispatcher.Handle;
        tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Lecturer Assistant — проектор", Visible = true };
        if (File.Exists(Path.Combine(directory, "display-recovery.json"))) status = "Есть сохранённые настройки — проверьте возврат экранов";
        UpdateMenu(); SystemEvents.DisplaySettingsChanged += OnScreensChanged;
        var saved = Path.Combine(directory, "origin.txt");
        if (File.Exists(saved))
        {
            try { origin = PublicScene.ValidateOrigin(File.ReadAllText(saved)); var token = CredentialStore.Read(Path.Combine(directory, "device.dpapi")); if (token is not null) Connect(token); }
            catch { status = "Нужно повторно подключить устройство"; UpdateMenu(); }
        }
    }
    private void OnScreensChanged(object? sender, EventArgs args) => dispatcher.BeginInvoke(() => { projection?.Neutral(); status = "Экраны изменились — повторите проверку"; UpdateMenu(); });
    private void UpdateMenu()
    {
        var menu = new ContextMenuStrip(); menu.Items.Add(status).Enabled = false;
        if (!ProjectionForm.RuntimeAvailable()) menu.Items.Add("Для показа нужен Microsoft WebView2…", null, (_, _) => WebViewHelp());
        menu.Items.Add("Подключить к учреждению…", null, async (_, _) => await Pair());
        menu.Items.Add("Подготовить отдельный экран…", null, (_, _) => Prepare());
        menu.Items.Add("Остановить показ", null, (_, _) => { pendingLocalStop = true; projection?.Neutral(); status = "Показ остановлен локально"; UpdateMenu(); });
        menu.Items.Add("Вернуть настройку экранов…", null, (_, _) => Restore());
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        var startup = new ToolStripMenuItem("Запускать при входе") { Checked = key?.GetValue(StartupName) is string, CheckOnClick = false };
        startup.Click += (_, _) => ToggleStartup(); menu.Items.Add(startup);
        menu.Items.Add("Отключить устройство", null, (_, _) => { Stop(); foreach (var file in new[] { "device.dpapi", "origin.txt" }) File.Delete(Path.Combine(directory, file)); origin = null; status = "Отключено. Отзовите устройство также на сайте."; UpdateMenu(); });
        menu.Items.Add("Microsoft WebView2 и помощь…", null, (_, _) => WebViewHelp());
        menu.Items.Add("Удалить помощник…", null, (_, _) => Uninstall());
        menu.Items.Add("Выйти", null, (_, _) => { Stop(); ExitThread(); });
        var old = tray.ContextMenuStrip; tray.ContextMenuStrip = menu; old?.Dispose();
    }
    private async Task Pair()
    {
        Stop();
        using var dialog = new Form { Text = "Подключить проектор", Width = 480, Height = 270, StartPosition = FormStartPosition.CenterScreen, MinimizeBox = false, MaximizeBox = false };
        var address = new TextBox { PlaceholderText = "https://адрес-учреждения/", Text = origin?.AbsoluteUri ?? "", Dock = DockStyle.Top };
        var code = new TextBox { PlaceholderText = "Одноразовый код из Настройки проектора", Dock = DockStyle.Top };
        var button = new Button { Text = "Подключить", Dock = DockStyle.Bottom, DialogResult = DialogResult.OK, Height = 40 };
        var content = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), RowCount = 4, ColumnCount = 1 };
        content.Controls.Add(new Label { AutoSize = true, Text = "Откройте Настройку проектора на сайте учреждения.\nВведите адрес и одноразовый код. Пароль аккаунта не нужен." });
        content.Controls.Add(address); content.Controls.Add(code); content.Controls.Add(button); dialog.Controls.Add(content); dialog.AcceptButton = button;
        if (dialog.ShowDialog() != DialogResult.OK) return;
        try
        {
            origin = PublicScene.ValidateOrigin(address.Text);
            using var http = Http();
            var platform = RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "WINDOWS_ARM64" : "WINDOWS_X64";
            var paired = await new AgentClient(http, origin).Pair(new(code.Text, Environment.MachineName, platform, ReleaseInfo.Version, Environment.OSVersion.Version.ToString()), CancellationToken.None);
            if (paired.ProtocolVersion != 1 || paired.DeviceToken.Length != 64) throw new InvalidDataException("BAD_PAIR_RESPONSE");
            CredentialStore.Save(Path.Combine(directory, "device.dpapi"), paired.DeviceToken);
            File.WriteAllText(Path.Combine(directory, "origin.txt"), origin.AbsoluteUri); Connect(paired.DeviceToken);
        }
        catch { status = "Подключение не удалось. Проверьте код и разрешение администратора."; UpdateMenu(); }
    }
    private static HttpClient Http() => new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromSeconds(10) };
    private void Connect(string token)
    {
        cancellation?.Cancel(); cancellation = new(); var ct = cancellation.Token; var selectedOrigin = origin!; var currentGeneration = ++generation;
        status = "Готов — управление на сайте"; UpdateMenu();
        _ = Task.Run(async () =>
        {
            using var http = Http();
            try { await new AgentRuntime(new AgentClient(http, selectedOrigin, token), selectedOrigin, new GenerationHost(this, currentGeneration), ReleaseInfo.Version).Run(ct); }
            catch (OperationCanceledException) { }
            catch { dispatcher.BeginInvoke(() => { projection?.Neutral(); status = "Связь остановлена — используйте сайт"; UpdateMenu(); }); }
        });
    }
    public Task<HostResult> Execute(HostAction action, CancellationToken ct) => ExecuteFor(action, ct, generation);
    private Task<HostResult> ExecuteFor(HostAction action, CancellationToken ct, long expectedGeneration)
    {
        var completion = new TaskCompletionSource<HostResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        dispatcher.BeginInvoke(async () =>
        {
            try
            {
                if (generation != expectedGeneration || ct.IsCancellationRequested) { completion.TrySetResult(new(action.Id, false, "CONNECTION_REPLACED")); return; }
                if (action.Type == "GET_SCREENS")
                {
                    var screens = Screen.AllScreens.Take(16).Select(s => new ScreenInfo(ScreenId(s), s.DeviceName, s.Bounds.Width, s.Bounds.Height, s.Primary)).ToArray();
                    completion.TrySetResult(new(action.Id, true, Screens: screens, LocalStop: pendingLocalStop, UpdateHandoffFailed: pendingUpdateHandoffFailed)); pendingLocalStop = false; pendingUpdateHandoffFailed = false; return;
                }
                switch (action.Type)
                {
                    case "TEST_TARGET":
                    case "START_PUBLIC_PROJECTION":
                        var target = Screen.AllScreens.FirstOrDefault(s => ScreenId(s) == action.TargetScreenId && !s.Primary)
                            ?? throw new InvalidDataException("TARGET_NOT_INDEPENDENT_EXTERNAL");
                        if (origin is null) throw new InvalidDataException("PAIRING_REQUIRED");
                        projection?.Close(); projection?.Dispose(); projection = new(target, origin);
                        if (action.Type == "TEST_TARGET") projection.Neutral("Проверка проектора\n\n" + action.TestCode + "\n\nПодтвердите этот код на компьютере преподавателя.");
                        projection.Show();
                        if (action.Type == "START_PUBLIC_PROJECTION") await projection.ShowScene(new Uri(action.Url!));
                        status = action.Type == "TEST_TARGET" ? "Проверка экрана" : "Идёт показ"; break;
                    case "NEUTRAL_STOP": projection?.Neutral(); status = "Показ остановлен"; break;
                    case "TARGET_HELP": status = "Основной экран: выберите проектор в браузерном мастере"; break;
                    case "UPDATE_READY":
                        projection?.Neutral();
                        var updaterPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "updater", "Projector.Updater.exe"));
                        if (pendingUpdate is not null) throw new InvalidDataException("UPDATER_ALREADY_PREPARING");
                        pendingUpdate = NativeUpdateHandoff.StartUpdater(action, updaterPath, RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "WINDOWS_ARM64" : "WINDOWS_X64", Environment.OSVersion.Version.ToString());
                        status = "Подготовка обновления — помощник остаётся на связи"; UpdateMenu();
                        completion.TrySetResult(new(action.Id, true)); return;
                    case "UPDATE_STATUS": status = action.TestCode == "REQUIRED" ? "Требуется обновление — доступен сайт" : "Обновление доступно после показа"; break;
                    default: throw new InvalidDataException("UNKNOWN_NATIVE_ACTION");
                }
                UpdateMenu(); completion.TrySetResult(new(action.Id, true));
            }
            catch (Exception ex)
            {
                projection?.Neutral();
                if (ex is InvalidDataException { Message: "WEBVIEW2_RUNTIME_MISSING" }) { status = "Для показа нужен Microsoft WebView2 — откройте помощь в меню"; UpdateMenu(); }
                completion.TrySetResult(new(action.Id, false, ex is InvalidDataException ? ex.Message : "NATIVE_OPERATION_FAILED"));
            }
        });
        return completion.Task.WaitAsync(ct);
    }
    private static string ScreenId(Screen screen) => DisplaySafety.Fingerprint($"{NativeDisplays.ScreenIdentity(screen)}@{screen.Bounds.X},{screen.Bounds.Y}:{screen.Bounds.Width}x{screen.Bounds.Height}");
    private void Prepare()
    {
        if (MessageBox.Show("Зеркальные экраны временно станут отдельными. Исходная конфигурация сохранится. Проектор сначала нужно проверить кодом. Вернуть настройки можно отдельно после скрытия служебного окна.", "Подготовить отдельный экран?", MessageBoxButtons.OKCancel) != DialogResult.OK) return;
        try { projection?.Neutral(); display.PrepareIndependent(); status = "Выберите и проверьте экран на сайте"; }
        catch { status = "Подготовка не удалась — используйте браузерный мастер"; }
        UpdateMenu();
    }
    private void Restore()
    {
        projection?.Neutral();
        if (MessageBox.Show("Скройте служебное окно преподавателя. Если вернётся дублирование, аудитория увидит основной экран. Изменённые вами вручную настройки не будут перезаписаны.\n\nСлужебное окно скрыто — вернуть?", "Вернуть экраны", MessageBoxButtons.OKCancel) != DialogResult.OK) return;
        try { var result = display.Restore(true); status = result is "Restore" or "Unchanged" ? "Настройка возвращена" : "Конфигурация изменилась — возврат пропущен"; projection?.Close(); projection?.Dispose(); projection = null; }
        catch { status = "Возврат не удался — откройте настройки Windows"; }
        UpdateMenu();
    }
    private void ToggleStartup()
    {
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
        if (key.GetValue(StartupName) is string) key.DeleteValue(StartupName);
        else if (MessageBox.Show("Запускать установленный помощник после входа в Windows? В простое он не захватывает экран и не меняет настройки.", "Автозапуск", MessageBoxButtons.OKCancel) == DialogResult.OK)
        {
            var installedRoot = Environment.GetEnvironmentVariable("LA_PROJECTOR_INSTALL_ROOT");
            var launcher = installedRoot is null ? null : Path.Combine(installedRoot, "launcher", "Projector.Launcher.exe");
            if (launcher is null || !File.Exists(launcher)) status = "Автозапуск станет доступен после установки стабильного launcher";
            else key.SetValue(StartupName, '"' + launcher + "\" \"" + installedRoot + '"');
        }
        UpdateMenu();
    }
    private static void WebViewHelp()
    {
        var message = ProjectionForm.RuntimeAvailable()
            ? "Microsoft WebView2 доступен. Помощник использует отдельное окно и не требует входа в браузер. Открыть официальную страницу Microsoft с описанием и установщиком?"
            : "Для показа нужен Microsoft Edge WebView2 Runtime. Откройте официальную страницу Microsoft и установите Evergreen Runtime. Если установка запрещена учреждением, обратитесь к администратору или используйте браузерный мастер.\n\nОткрыть страницу Microsoft?";
        if (MessageBox.Show(message, "Microsoft WebView2", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
        {
            try { Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true }); }
            catch { MessageBox.Show("Не удалось открыть браузер. Страница Microsoft: https://developer.microsoft.com/microsoft-edge/webview2/", "Microsoft WebView2"); }
        }
    }
    private void Uninstall()
    {
        if (File.Exists(Path.Combine(directory, "display-recovery.json")))
        {
            MessageBox.Show("Сначала выберите «Вернуть настройку экранов…». Скрывайте служебное окно перед возвратом дублирования. Если конфигурация изменилась, проверьте её в настройках Windows: журнал восстановления не удаляется автоматически.", "Удаление помощника", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        var installedRoot = Environment.GetEnvironmentVariable("LA_PROJECTOR_INSTALL_ROOT");
        var uninstaller = installedRoot is null ? null : Path.Combine(installedRoot, "uninstall", "unins000.exe");
        if (uninstaller is null || !File.Exists(uninstaller))
        {
            MessageBox.Show("Установщик не найден. Установите актуальный пакет заново для восстановления удаления. Исходную сборку можно удалить после выхода из помощника. Подключение к учреждению отключается отдельно в этом меню и на сайте.", "Удаление помощника");
            return;
        }
        if (MessageBox.Show("Помощник остановит показ, завершит работу и откроет удаление. Для удаления сохранённого подключения сначала выберите «Отключить устройство» и отзовите его на сайте.\n\nОткрыть удаление?", "Удаление помощника", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        try { Process.Start(new ProcessStartInfo(uninstaller) { UseShellExecute = true }); Stop(); ExitThread(); }
        catch { MessageBox.Show("Не удалось открыть удаление. Выйдите из помощника и откройте «Установленные приложения» в настройках Windows.", "Удаление помощника"); }
    }
    private void Stop() { generation++; cancellation?.Cancel(); projection?.Neutral(); status = "Показ остановлен локально"; UpdateMenu(); }
    private sealed class GenerationHost(TrayApplication owner, long expectedGeneration) : IProjectionHost
    {
        public Task<HostResult> Execute(HostAction action, CancellationToken ct) => owner.ExecuteFor(action, ct, expectedGeneration);
    }
    protected override void ExitThreadCore()
    {
        SystemEvents.DisplaySettingsChanged -= OnScreensChanged; cancellation?.Cancel(); projection?.Dispose(); updateStopTimer.Dispose(); tray.Visible = false; tray.Dispose(); dispatcher.Dispose(); base.ExitThreadCore();
    }
}
