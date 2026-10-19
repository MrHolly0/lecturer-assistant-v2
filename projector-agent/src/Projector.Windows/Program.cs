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
        if (args is ["--preflight", _]) return Preflight(args);
        if (args is ["--workspace-self-test", var report]) return WorkspaceSelfTest.Run(report);
        if (args.Length > 1) return 1;
        PairLink? requestedPair = null;
        if (args is [var pairAddress])
        {
            try { requestedPair = PairLink.Parse(pairAddress); }
            catch (Exception ex) when (ex is InvalidDataException or UriFormatException) { return 1; }
        }
        using var singleton = new Mutex(true, "Local\\LecturerAssistantProjector", out var first);
        if (!first) return requestedPair is null || PairLinkPipe.Forward(args[0]) ? 0 : 1;
        foreach (var maintenanceName in new[] { "Local\\LecturerAssistantProjectorSetup", "Local\\LecturerAssistantProjectorMaintenance" })
        {
            if (Mutex.TryOpenExisting(maintenanceName, out var maintenance)) { maintenance.Dispose(); return 0; }
        }
        ApplicationConfiguration.Initialize(); Application.Run(new TrayApplication(requestedPair));
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
    private readonly PairLinkPipe pairingPipe;
    private bool pairingInProgress;
    private readonly string directory;
    private readonly NativeDisplays display;
    private ProjectionForm? projection;
    private RemoteForm? remote;
    private RemoteForm? openingRemote;
    private ScreenIdentification? identification;
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
    public TrayApplication(PairLink? requestedPair = null)
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
        pairingPipe = new PairLinkPipe(link => dispatcher.BeginInvoke(async () => await PairFromLink(link)));
        if (File.Exists(Path.Combine(directory, "display-recovery.json"))) status = "Есть сохранённые настройки — проверьте возврат экранов";
        UpdateMenu(); SystemEvents.DisplaySettingsChanged += OnScreensChanged;
        var saved = Path.Combine(directory, "origin.txt");
        if (File.Exists(saved))
        {
            try { origin = PublicScene.ValidateOrigin(File.ReadAllText(saved)); var token = CredentialStore.Read(Path.Combine(directory, "device.dpapi")); if (token is not null) Connect(token); }
            catch { status = "Нужно повторно подключить устройство"; UpdateMenu(); }
        }
        if (requestedPair is not null) dispatcher.BeginInvoke(async () => await PairFromLink(requestedPair));
    }
    private void OnScreensChanged(object? sender, EventArgs args) => dispatcher.BeginInvoke(() => { identification?.Dispose(); identification = null; projection?.Neutral(); status = "Экраны изменились — повторите проверку"; UpdateMenu(); });
    private void UpdateMenu()
    {
        var menu = new ContextMenuStrip(); menu.Items.Add(status).Enabled = false;
        if (!ProjectionForm.RuntimeAvailable()) menu.Items.Add("Для показа нужен Microsoft WebView2…", null, (_, _) => WebViewHelp());
        menu.Items.Add("Подключить к учреждению…", null, async (_, _) => await Pair());
        menu.Items.Add("Подготовить отдельный экран…", null, (_, _) => { try { Prepare(); } catch { MessageBox.Show(status, "Настройка проектора", MessageBoxButtons.OK, MessageBoxIcon.Warning); } });
        menu.Items.Add("Показать пульт", null, (_, _) => { if (remote is { IsDisposed: false }) { remote.WindowState = FormWindowState.Normal; remote.Show(); remote.Activate(); } }).Enabled = remote is { IsDisposed: false };
        menu.Items.Add("Остановить показ", null, (_, _) => { pendingLocalStop = true; projection?.Neutral(); CloseRemote(); status = "Показ остановлен локально"; UpdateMenu(); });
        menu.Items.Add("Вернуть настройку экранов…", null, (_, _) => { try { Restore(); } catch { MessageBox.Show(status, "Настройка проектора", MessageBoxButtons.OK, MessageBoxIcon.Warning); } });
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
    private async Task PairFromLink(PairLink link)
    {
        if (pairingInProgress) return;
        pairingInProgress = true;
        try
        {
            if (MessageBox.Show("Подключить этот компьютер к учреждению?\n\n" + link.Origin.Host +
                "\n\nСайт сможет открывать публичный материал на выбранном проекторе и приватный пульт. Перед изменением режима экранов будет отдельное подтверждение. Пароль аккаунта не передаётся.",
                "Подключить помощник проектора", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            Stop();
            using var http = Http();
            var platform = RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "WINDOWS_ARM64" : "WINDOWS_X64";
            var paired = await new AgentClient(http, link.Origin).Pair(new(link.Code, Environment.MachineName, platform, ReleaseInfo.Version, Environment.OSVersion.Version.ToString()), CancellationToken.None);
            if (paired.ProtocolVersion != 1 || paired.DeviceToken.Length != 64) throw new InvalidDataException("BAD_PAIR_RESPONSE");
            CredentialStore.Save(Path.Combine(directory, "device.dpapi"), paired.DeviceToken);
            File.WriteAllText(Path.Combine(directory, "origin.txt"), link.Origin.AbsoluteUri); origin = link.Origin; Connect(paired.DeviceToken);
        }
        catch { status = "Подключение не удалось. Вернитесь на сайт и создайте новый код."; UpdateMenu(); }
        finally { pairingInProgress = false; }
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
            catch { dispatcher.BeginInvoke(() => { projection?.Neutral(); CloseRemote(); status = "Связь остановлена — используйте сайт"; UpdateMenu(); }); }
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
                    var screens = CurrentScreens().Select((s, index) => new ScreenInfo(ScreenId(s), $"Экран {index + 1} · {s.DeviceName}", s.Bounds.Width, s.Bounds.Height, s.Primary)).ToArray();
                    completion.TrySetResult(new(action.Id, true, Screens: screens, LocalStop: pendingLocalStop, UpdateHandoffFailed: pendingUpdateHandoffFailed)); pendingLocalStop = false; pendingUpdateHandoffFailed = false; return;
                }
                switch (action.Type)
                {
                    case "PREPARE_DISPLAYS":
                        if (!Prepare()) { completion.TrySetResult(new(action.Id, false, "LOCAL_PREPARATION_CANCELLED")); return; }
                        break;
                    case "IDENTIFY_SCREENS":
                        identification?.Dispose(); identification = new(CurrentScreens());
                        status = "Номера экранов показаны на 15 секунд"; break;
                    case "RESTORE_DISPLAYS":
                        if (!Restore()) { completion.TrySetResult(new(action.Id, false, "LOCAL_RESTORE_CANCELLED")); return; }
                        break;
                    case "FOCUS_PRIVATE_REMOTE":
                        if (origin is null || action.RemoteUrl is null || !Uri.TryCreate(action.RemoteUrl, UriKind.Absolute, out var remoteScene) || !RemoteForm.AllowedScene(origin, remoteScene))
                            throw new InvalidDataException("REMOTE_URL_REJECTED");
                        if (remote is { IsDisposed: false } existing && existing.MatchesScene(remoteScene))
                        { existing.WindowState = FormWindowState.Normal; existing.Show(); existing.Activate(); }
                        else await ShowRemote(remoteScene);
                        break;
                    case "TEST_TARGET":
                    case "START_PUBLIC_PROJECTION":
                        identification?.Dispose(); identification = null;
                        var target = Screen.AllScreens.FirstOrDefault(s => ScreenId(s) == action.TargetScreenId && !s.Primary)
                            ?? throw new InvalidDataException("TARGET_NOT_INDEPENDENT_EXTERNAL");
                        if (origin is null) throw new InvalidDataException("PAIRING_REQUIRED");
                        projection?.Close(); projection?.Dispose(); projection = new(target, origin);
                        if (action.Type == "TEST_TARGET") projection.Neutral("Проверка проектора\n\n" + action.TestCode + "\n\nПодтвердите этот код на компьютере преподавателя.");
                        projection.Show();
                        if (action.Type == "START_PUBLIC_PROJECTION")
                        {
                            await projection.ShowScene(new Uri(action.Url!));
                            if (action.RemoteUrl is { } remoteAddress) await ShowRemote(new Uri(remoteAddress));
                        }
                        status = action.Type == "TEST_TARGET" ? "Проверка экрана" : "Идёт показ"; break;
                    case "NEUTRAL_STOP": projection?.Neutral(); CloseRemote(); identification?.Dispose(); identification = null; status = "Показ остановлен"; break;
                    case "TARGET_HELP": status = "Основной экран: выберите проектор в браузерном мастере"; break;
                    case "UPDATE_READY":
                        projection?.Neutral(); CloseRemote();
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
                // Failure to focus the private controller must not interrupt an existing show.
                if (action.Type != "FOCUS_PRIVATE_REMOTE")
                {
                    projection?.Neutral(); CloseRemote();
                    if (ex is InvalidDataException { Message: "WEBVIEW2_RUNTIME_MISSING" }) { status = "Для показа нужен Microsoft WebView2 — откройте помощь в меню"; UpdateMenu(); }
                }
                completion.TrySetResult(new(action.Id, false, ex is InvalidDataException ? ex.Message : "NATIVE_OPERATION_FAILED"));
            }
        });
        return completion.Task.WaitAsync(ct);
    }
    private static Screen[] CurrentScreens() => Screen.AllScreens.Take(16).ToArray();
    private async Task ShowRemote(Uri scene)
    {
        if (origin is null) throw new InvalidDataException("PAIRING_REQUIRED");
        if (openingRemote is not null) throw new InvalidDataException("REMOTE_ALREADY_OPENING");
        var prior = remote; var expectedGeneration = generation;
        var form = new RemoteForm(origin, scene, () => { projection?.Show(); projection?.Activate(); }); openingRemote = form;
        form.FormClosed += (_, _) => {
            if (ReferenceEquals(openingRemote, form)) openingRemote = null;
            if (ReferenceEquals(remote, form)) { remote = null; UpdateMenu(); }
        };
        try
        {
            form.Show(); await form.LoadRemote();
            if (form.IsDisposed || !ReferenceEquals(openingRemote, form) || generation != expectedGeneration)
                throw new InvalidDataException("REMOTE_OPEN_CANCELLED");
            // Keep the previous private window/capture alive until its replacement initialized.
            remote = form; openingRemote = null; prior?.Close(); prior?.Dispose(); form.Activate();
        }
        catch
        {
            if (ReferenceEquals(openingRemote, form)) openingRemote = null;
            form.Close(); form.Dispose(); throw;
        }
    }
    private void CloseRemote()
    {
        var pending = openingRemote; openingRemote = null; pending?.Close(); pending?.Dispose();
        var prior = remote; remote = null; prior?.Close(); prior?.Dispose();
    }
    private static string ScreenId(Screen screen) => DisplaySafety.Fingerprint($"{NativeDisplays.ScreenIdentity(screen)}@{screen.Bounds.X},{screen.Bounds.Y}:{screen.Bounds.Width}x{screen.Bounds.Height}");
    private bool Prepare()
    {
        if (MessageBox.Show("Зеркальные экраны временно станут отдельными. Исходная конфигурация сохранится. Проектор сначала нужно проверить кодом. Вернуть настройки можно отдельно после скрытия служебного окна.", "Подготовить отдельный экран?", MessageBoxButtons.OKCancel) != DialogResult.OK) return false;
        try { projection?.Neutral(); display.PrepareIndependent(); status = "Выберите и проверьте экран на сайте"; }
        catch { status = "Подготовка не удалась — используйте браузерный мастер"; UpdateMenu(); throw; }
        UpdateMenu(); return true;
    }
    private bool Restore()
    {
        projection?.Neutral(); CloseRemote();
        if (MessageBox.Show("Скройте служебное окно преподавателя. Если вернётся дублирование, аудитория увидит основной экран. Изменённые вами вручную настройки не будут перезаписаны.\n\nСлужебное окно скрыто — вернуть?", "Вернуть экраны", MessageBoxButtons.OKCancel) != DialogResult.OK) return false;
        try
        {
            var result = display.Restore(true);
            if (result is not ("Restore" or "Unchanged" or "UNCHANGED")) throw new InvalidDataException("DISPLAY_CONFIGURATION_CHANGED_RESTORE_SKIPPED");
            status = "Настройка возвращена"; projection?.Close(); projection?.Dispose(); projection = null;
        }
        catch { status = "Возврат пропущен — проверьте настройки Windows. Изменённая вами конфигурация сохранена."; UpdateMenu(); throw; }
        UpdateMenu(); return true;
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
    private void Stop() { generation++; cancellation?.Cancel(); projection?.Neutral(); CloseRemote(); identification?.Dispose(); identification = null; status = "Показ остановлен локально"; UpdateMenu(); }
    private sealed class GenerationHost(TrayApplication owner, long expectedGeneration) : IProjectionHost
    {
        public Task<HostResult> Execute(HostAction action, CancellationToken ct) => owner.ExecuteFor(action, ct, expectedGeneration);
    }
    protected override void ExitThreadCore()
    {
        SystemEvents.DisplaySettingsChanged -= OnScreensChanged; cancellation?.Cancel(); pairingPipe.Dispose(); openingRemote?.Dispose(); remote?.Dispose(); identification?.Dispose(); projection?.Dispose(); updateStopTimer.Dispose(); tray.Visible = false; tray.Dispose(); dispatcher.Dispose(); base.ExitThreadCore();
    }
}
