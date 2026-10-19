import AppKit
import Foundation
import Security
import Darwin

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private let projection = ProjectionWindow()
    private let remote = RemoteWindow()
    private let capture = NativeCapture()
    private let identification = ScreenIdentification()
    private var display: DisplayController!
    private var process: Process?
    private var generation = UUID()
    private var pendingLocalStop = false
    private var pendingUpdateHandoffFailed = false
    private var pendingUpdater: Process?
    private var preflightPath: URL?
    private var preflightID: String?
    private var preflightNonce: String?
    private var preflightStartedAt = 0.0
    private var input: Pipe?
    private var pending = Data()
    private var origin: URL?
    private var directory: URL!
    private var status = "Не подключён"
    private var updateStopTimer: Timer?
    private var instanceLock: Int32 = -1
    private var startupStatus = "UNAVAILABLE"
    private var connectionForm: ConnectionForm?
    private var localDialogOpen = false
    private var lastRemoteAction: [String: Any]?
    private var userInitiatedPairing = false
    private var pairingDraft: String?
    private var pairingError: String?
    private var savedConnectionAccount: String?
    private var savedKeychainStatus: OSStatus?

    func applicationDidFinishLaunching(_ notification: Notification) {
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LecturerProjector", isDirectory: true)
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { NSApp.terminate(nil); return }
        instanceLock = open(directory.appendingPathComponent("instance.lock").path, O_CREAT | O_RDWR, 0o600)
        guard instanceLock >= 0, flock(instanceLock, LOCK_EX | LOCK_NB) == 0 else { NSApp.terminate(nil); return }
        display = DisplayController(directory: directory)
        capture.event = { [weak self] event in self?.remote.emit(event) }
        capture.presentationWindow = { [weak self] in self?.remote.presentationWindow }
        remote.closed = { [weak self] in Task { @MainActor in await self?.capture.stop() } }
        remote.command = { [weak self] value in Task { @MainActor in await self?.applyRemoteCommand(value) } }
        startupStatus = (try? bootstrapCommand("--login-status")) ?? "UNAVAILABLE"
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "LA"
        rebuildMenu()
        updateStopTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let pairingFile = self.directory.appendingPathComponent("pending-pair.json")
                if self.connectionForm != nil && FileManager.default.fileExists(atPath: pairingFile.path) {
                    if NSApp.modalWindow === self.connectionForm?.alert.window { NSApp.abortModal() }
                }
                if !self.localDialogOpen {
                    if self.consumePairingRequest() { self.discardOpenRequest() }
                    else { self.consumeOpenRequest() }
                } else { self.discardOpenRequest() }
                if let updater = self.pendingUpdater {
                    if self.preflightReady() { self.pendingUpdater = nil; self.stop(); NSApp.terminate(nil); return }
                    if !updater.isRunning || ProcessInfo.processInfo.systemUptime - self.preflightStartedAt > 600 {
                        self.pendingUpdater = nil; self.pendingUpdateHandoffFailed = true
                        self.status = "Подготовка обновления не удалась — помощник продолжает работать"; self.rebuildMenu()
                    }
                }
                if self.updateStopRequested() { self.stop(); NSApp.terminate(nil) }
            }
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.projection.neutralize(); await self?.capture.stop(); self?.identification.dismiss(); self?.status = "Экраны изменились — повторите проверку"; self?.rebuildMenu() }
        }
        let config = directory.appendingPathComponent("origin.txt")
        if let saved = try? String(contentsOf: config, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           let url = Self.validOrigin(saved) {
            origin = url; savedConnectionAccount = saved; resumeSavedConnection(allowInteraction: false)
        }
        // Recovery journal is never applied silently at login: the teacher may have changed the display setup meanwhile.
        if FileManager.default.fileExists(atPath: directory.appendingPathComponent("display-recovery.json").path) {
            status = "Есть сохранённая настройка экранов — проверьте возврат"; rebuildMenu()
        }
    }
    private func applyRemoteCommand(_ value: [String: Any]) async {
        guard let action = value["action"] as? String else { return }
        switch action {
        case "chooseSource": await capture.chooseSource()
        case "publish": await capture.startPublishing()
        case "stopCapture": await capture.stop()
        case "stopProjection": stop()
        case "pause": await capture.setPaused(value["paused"] as? Bool ?? true)
        case "focusProjection": projection.focus()
        case "ready", "capabilities": remote.emit(["type": "capabilities", "platform": "MACOS", "nativeCapture": true, "captureExclusion": ["supported": true, "enabled": true]]); capture.status()
        case "screenRecordingSettings": if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") { NSWorkspace.shared.open(url) }
        default: break
        }
    }
    static func exerciseRemoteCommandsFixture() async throws -> [String: Any] {
        // No applicationDidFinishLaunching: no saved account, status item, timer or coordinator.
        let delegate = AppDelegate()
        let origin = URL(string: "https://school.example/")!
        let course = UUID(), session = UUID(), token = UUID().uuidString.lowercased() + "." + String(repeating: "a", count: 64)
        let url = "https://school.example/#/helper/remote?courseId=\(course.uuidString)&sessionId=\(session.uuidString)&controlToken=\(token)"
        let action: [String: Any] = ["remoteUrl": url, "courseId": course.uuidString, "sessionId": session.uuidString, "controlToken": token]
        try delegate.configureRemote(action, origin: origin, present: false)
        guard delegate.lastRemoteAction != nil, !delegate.remote.isPresented else { throw HostError.code("WORKSPACE_MANUAL_REMOTE_SCOPE_LOST") }
        await delegate.applyRemoteCommand(["action": "stopCapture"])
        guard !delegate.pendingLocalStop, delegate.lastRemoteAction != nil else { throw HostError.code("WORKSPACE_SOURCE_STOP_CLOSED_PROJECTION") }
        await delegate.applyRemoteCommand(["action": "stopProjection"])
        guard delegate.pendingLocalStop, delegate.lastRemoteAction == nil, !delegate.capture.isActive else { throw HostError.code("WORKSPACE_FOOTER_STOP_NOT_LOCAL_STOP") }
        return ["projectorPreparationKeepsRemoteClosed": true, "manualRemoteScopePreserved": true,
                "sourceStopKeepsProjectionScope": true, "footerStopSetsLocalStop": true]
    }
    static func makeScreenReplyFixture() -> @MainActor () async throws -> Void {
        let delegate = AppDelegate(), pipe = Pipe(); delegate.input = pipe
        return {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                DispatchQueue.global().async {
                    Task { @MainActor in
                        do {
                            let id = UUID().uuidString
                            let data = try JSONSerialization.data(withJSONObject: ["id": id, "type": "GET_SCREENS"])
                            delegate.receive(data + Data([10]))
                            let reply = pipe.fileHandleForReading.availableData
                            guard let value = try JSONSerialization.jsonObject(with: reply) as? [String: Any],
                                  value["id"] as? String == id, value["success"] as? Bool == true else { throw HostError.code("CAPTURE_DIALOG_BAD_NATIVE_REPLY") }
                            continuation.resume()
                        } catch { continuation.resume(throwing: error) }
                    }
                }
            }
        }
    }
    static func exerciseSavedConnectionFixture() throws -> [String: Any] {
        let delegate = AppDelegate(), site = URL(string: "https://fixture.invalid/")!
        delegate.origin = site; delegate.savedConnectionAccount = site.absoluteString
        var interactions: [Bool] = [], resumed = false
        delegate.resumeSavedConnection(allowInteraction: false, read: { _, allowed in interactions.append(allowed); return .unavailable(errSecInteractionNotAllowed) })
        guard delegate.origin == site, delegate.savedConnectionAccount == site.absoluteString,
              delegate.savedKeychainStatus == errSecInteractionNotAllowed, delegate.process == nil else { throw HostError.code("KEYCHAIN_STARTUP_LOST_CONNECTION") }
        delegate.resumeSavedConnection(allowInteraction: true, read: { _, allowed in interactions.append(allowed); return .unavailable(errSecUserCanceled) })
        guard delegate.origin == site, delegate.savedKeychainStatus == errSecUserCanceled else { throw HostError.code("KEYCHAIN_CANCEL_LOST_CONNECTION") }
        delegate.resumeSavedConnection(allowInteraction: true, read: { _, allowed in interactions.append(allowed); return .token("fixture-resume-token") }, begin: { origin, token in
            resumed = origin == site && token == "fixture-resume-token"
        })
        guard interactions == [false, true, true], resumed, delegate.savedKeychainStatus == nil else { throw HostError.code("KEYCHAIN_EXPLICIT_RETRY_DID_NOT_RESUME") }
        return ["savedOriginPreserved": true, "quietStartupDoesNotRequestAuthentication": true,
                "cancelPreservesConnection": true, "explicitRetryResumesWithoutPairing": true]
    }
    private func resumeSavedConnection(allowInteraction: Bool, read: (String, Bool) -> SavedKeychainResult = Keychain.readResult,
                                       begin: ((URL, String) -> Void)? = nil) {
        guard let account = savedConnectionAccount, let origin else { return }
        switch read(account, allowInteraction) {
        case .token(let token):
            savedKeychainStatus = nil
            if let begin { begin(origin, token) } else { start(origin: origin, token: token, pairingCode: nil) }
        case .missing:
            savedKeychainStatus = errSecItemNotFound; status = "Сохранённый ключ не найден — откройте помощник"
        case .unavailable(let code):
            savedKeychainStatus = code; status = "Разрешите доступ к Связке ключей — откройте помощник"
        }
        rebuildMenu()
    }
    private func rebuildMenu() {
        guard item != nil else { return }
        let menu = NSMenu()
        let label = NSMenuItem(title: status, action: nil, keyEquivalent: ""); label.isEnabled = false; menu.addItem(label)
        add(menu, "Подключить к учреждению…", #selector(pair))
        add(menu, "Открыть помощник…", #selector(revealFromUser))
        add(menu, "Подготовить отдельный экран…", #selector(prepare))
        add(menu, "Остановить показ", #selector(stop))
        add(menu, "Вернуть настройку экранов…", #selector(restore))
        let startup = NSMenuItem(title: "Запускать при входе", action: #selector(toggleStartup), keyEquivalent: "")
        startup.target = self; startup.state = startupStatus == "ENABLED" ? .on : .off
        startup.isEnabled = bootstrapExecutable() != nil; menu.addItem(startup)
        if startupStatus == "REQUIRES_APPROVAL" { add(menu, "Разрешить автозапуск в настройках macOS…", #selector(startupHelp)) }
        add(menu, "Отключить устройство…", #selector(unpair))
        add(menu, "Сохранить диагностику…", #selector(diagnostics))
        add(menu, "Удалить помощник…", #selector(uninstall))
        add(menu, "Удаление и помощь", #selector(help))
        add(menu, "Выйти", #selector(quit))
        item.menu = menu
    }
    private func add(_ menu: NSMenu, _ title: String, _ selector: Selector) {
        let action = NSMenuItem(title: title, action: selector, keyEquivalent: ""); action.target = self; menu.addItem(action)
    }
    private func updateStopRequested() -> Bool {
        let environment = ProcessInfo.processInfo.environment
        guard let root = environment["LA_PROJECTOR_INSTALL_ROOT"], let id = environment["LA_PROJECTOR_UPDATE_ID"],
              let nonce = environment["LA_PROJECTOR_UPDATE_NONCE"], id.count >= 8, id.count <= 80,
              id.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 }) else { return false }
        let file = URL(fileURLWithPath: root).appendingPathComponent("health/" + id + ".stop")
        guard let data = try? Data(contentsOf: file), data.count <= 4096,
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return message["transactionId"] as? String == id && message["nonce"] as? String == nonce
    }
    @objc private func pair() {
        guard !localDialogOpen else { connectionForm?.alert.window.makeKeyAndOrderFront(nil); return }
        localDialogOpen = true
        let form = ConnectionForm(origin: origin?.absoluteString ?? ""); connectionForm = form
        if let pairingDraft { form.code.stringValue = pairingDraft }
        if let pairingError { form.validationError(pairingError) }
        defer { connectionForm = nil; localDialogOpen = false; form.alert.window.close() }
        NSApp.activate(ignoringOtherApps: true)
        while form.alert.runModal() == .alertFirstButtonReturn {
            guard let url = Self.validOrigin(form.address.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) else { form.validationError("Введите адрес сайта учреждения, начинающийся с https://."); continue }
            guard ConnectionForm.validCode(form.code.stringValue) else { form.validationError("Нужен код подключения помощника из 12 букв и цифр. Код занятия со слайда не подходит."); continue }
            start(origin: url, token: nil, pairingCode: ConnectionForm.normalizedCode(form.code.stringValue), userInitiated: true); return
        }
    }
    @objc private func revealFromUser() {
        guard !localDialogOpen else { connectionForm?.alert.window.makeKeyAndOrderFront(nil); return }
        if let origin, let action = lastRemoteAction, (try? showRemote(action, origin: origin)) != nil { return }
        if process?.isRunning != true, savedConnectionAccount != nil {
            localDialogOpen = true
            let alert = NSAlert(); alert.messageText = "Восстановить сохранённое подключение"
            alert.informativeText = savedKeychainStatus == errSecItemNotFound
                ? "Адрес учреждения сохранён, но ключ подключения не найден. Можно повторить проверку или подключить помощник по новому коду."
                : "Подключение к учреждению сохранено. Разрешите помощнику доступ к Связке ключей в системном запросе — повторное подключение по коду не требуется."
            alert.addButton(withTitle: "Повторить доступ"); alert.addButton(withTitle: "Подключить по коду…"); alert.addButton(withTitle: "Закрыть")
            NSApp.activate(ignoringOtherApps: true); let response = alert.runModal(); localDialogOpen = false
            if response == .alertFirstButtonReturn { resumeSavedConnection(allowInteraction: true) }
            else if response == .alertSecondButtonReturn { pair() }
            return
        }
        if origin == nil || process?.isRunning != true { pair(); return }
        localDialogOpen = true
        let alert = NSAlert(); alert.messageText = "Помощник проектора готов"
        alert.informativeText = status + "\n\nСайт: " + (origin?.absoluteString ?? "") + "\n\nВернитесь на сайт → «Открыть проектор». Выберите этот компьютер, проверьте номер экрана и подтвердите код на проекторе. Во время занятия здесь откроется отдельный пульт."
        alert.addButton(withTitle: "Готово"); alert.addButton(withTitle: "Подключить к другому сайту…")
        NSApp.activate(ignoringOtherApps: true)
        let result = alert.runModal(); localDialogOpen = false
        if result == .alertSecondButtonReturn { pair() }
    }
    private func discardOpenRequest() { try? FileManager.default.removeItem(at: directory.appendingPathComponent("pending-open.json")) }
    private func consumeOpenRequest() {
        let file = directory.appendingPathComponent("pending-open.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        defer { discardOpenRequest() }
        guard let attributes = try? file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]),
              attributes.isRegularFile == true, attributes.isSymbolicLink != true, (attributes.fileSize ?? 99999) <= 512,
              abs((attributes.contentModificationDate ?? .distantPast).timeIntervalSinceNow) < 60,
              let bytes = try? Data(contentsOf: file), let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: String],
              value["action"] == "show", UUID(uuidString: value["requestId"] ?? "") != nil else { return }
        discardOpenRequest(); revealFromUser()
    }
    private static func validOrigin(_ text: String) -> URL? {
        guard let components = URLComponents(string: text), components.scheme == "https", components.host != nil,
              components.user == nil, components.password == nil, (components.path == "" || components.path == "/"),
              components.query == nil, components.fragment == nil else { return nil }
        return URL(string: components.string!.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/")
    }
    private func consumePairingRequest() -> Bool {
        let file = directory.appendingPathComponent("pending-pair.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return false }
        defer { try? FileManager.default.removeItem(at: file) }
        guard let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]),
              values.isRegularFile == true, values.isSymbolicLink != true, (values.fileSize ?? 99999) <= 4096,
              abs((values.contentModificationDate ?? .distantPast).timeIntervalSinceNow) < 60,
              let data = try? Data(contentsOf: file), let request = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let rawOrigin = request["origin"], let origin = Self.validOrigin(rawOrigin), let code = request["code"],
              code.count == 12, code.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) }) else { return false }
        try? FileManager.default.removeItem(at: file)
        discardOpenRequest(); localDialogOpen = true
        defer { localDialogOpen = false }
        let alert = NSAlert(); alert.messageText = "Подключить помощник к сайту?"
        alert.informativeText = "Адрес учреждения: " + origin.absoluteString + "\n\nПодтвердите подключение, если только что нажали кнопку на этом сайте. Сайт сможет управлять только разрешённым показом; пароль аккаунта не передаётся."
        alert.addButton(withTitle: "Подключить"); alert.addButton(withTitle: "Отмена")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return true }
        start(origin: origin, token: nil, pairingCode: code, userInitiated: true)
        return true
    }
    private func start(origin: URL, token: String?, pairingCode: String?, userInitiated: Bool = false) {
        userInitiatedPairing = userInitiated && pairingCode != nil
        if userInitiatedPairing { pairingDraft = pairingCode; pairingError = nil }
        let bootstrap: [String: Any]
        do {
            bootstrap = try CoordinatorBootstrap.make(origin: origin, name: Host.current().localizedName ?? "Mac", platform: platform(),
                                                      deviceToken: token, pairingCode: pairingCode, directory: directory,
                                                      previousToken: { try Keychain.readForPairing(account: $0) })
        } catch HostError.code(let code) where code == "KEYCHAIN_ACCESS_REQUIRED" {
            status = "Разрешите доступ к Связке ключей"; rebuildMenu()
            pairingFailedIfNeeded("Разрешите помощнику доступ к Связке ключей в системном запросе и повторите подключение. Сохранённый ключ не удалён.")
            return
        } catch {
            status = "Не удалось прочитать ID этой установки"; rebuildMenu()
            pairingFailedIfNeeded("Не удалось прочитать постоянный ID этой установки. Подключение не изменено. Сохраните диагностику и обратитесь в поддержку.")
            return
        }
        self.origin = origin
        lastRemoteAction = nil
        generation = UUID(); let currentGeneration = generation
        process?.terminate(); projection.neutralize(); remote.close(); Task { await capture.stop() }; pending.removeAll()
        let coordinator = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/coordinator/Projector.Agent")
        guard FileManager.default.isExecutableFile(atPath: coordinator.path) else { status = "Компонент сборки отсутствует — используйте сайт"; rebuildMenu(); pairingFailedIfNeeded(); return }
        let process = Process(); let input = Pipe(); let output = Pipe()
        process.executableURL = coordinator; process.arguments = ["--native-stdio"]
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor in guard self?.generation == currentGeneration else { return }; self?.receive(data) }
        }
        process.terminationHandler = { [weak self] _ in Task { @MainActor in guard self?.generation == currentGeneration else { return }; self?.projection.neutralize(); self?.remote.close(); await self?.capture.stop(); self?.status = "Связь остановлена — используйте сайт"; self?.rebuildMenu(); self?.pairingFailedIfNeeded() } }
        do {
            try process.run(); self.process = process; self.input = input
            send(bootstrap); status = "Подключение…"; rebuildMenu()
        } catch { status = "Не удалось запустить компонент"; rebuildMenu(); pairingFailedIfNeeded() }
    }
    private func pairingFailedIfNeeded(_ message: String? = nil) {
        guard userInitiatedPairing else { return }; userInitiatedPairing = false
        pairingError = message ?? "Не удалось подключить помощник. Код мог истечь или уже использоваться. Получите новый 12-символьный код в «Настройке проектора» и проверьте адрес сайта и интернет."
        DispatchQueue.main.async { [weak self] in self?.pair() }
    }
    private func pairingSucceededIfNeeded() {
        guard userInitiatedPairing else { return }; userInitiatedPairing = false; pairingDraft = nil; pairingError = nil
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.localDialogOpen else { return }; self.localDialogOpen = true
            let alert = NSAlert(); alert.messageText = "Помощник подключён"
            alert.informativeText = "Вернитесь на сайт → «Открыть проектор». Выберите этот компьютер, проверьте номер экрана и подтвердите код на проекторе. Помощник останется доступен в строке меню LA."
            alert.addButton(withTitle: "Готово"); NSApp.activate(ignoringOtherApps: true); alert.runModal(); self.localDialogOpen = false
        }
    }
    private func platform() -> String {
        #if arch(arm64)
        return "MACOS_ARM64"
        #else
        return "MACOS_X64"
        #endif
    }
    private func receive(_ data: Data) {
        if data.isEmpty { return }
        pending.append(data)
        if pending.count > 262144 { process?.terminate(); return }
        while let newline = pending.firstIndex(of: 10) {
            let line = pending.prefix(upTo: newline); pending.removeSubrange(...newline)
            guard let action = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let type = action["type"] as? String,
                  let id = action["id"] as? String else { process?.terminate(); return }
            if type == "PAIR_RESULT" {
                guard let token = action["deviceToken"] as? String, let origin else { process?.terminate(); return }
                do {
                    try Keychain.store(token, account: origin.absoluteString)
                    try origin.absoluteString.write(to: directory.appendingPathComponent("origin.txt"), atomically: true, encoding: .utf8)
                    savedConnectionAccount = origin.absoluteString; savedKeychainStatus = nil
                    status = "Готов — управление на сайте"; rebuildMenu()
                    pairingSucceededIfNeeded()
                } catch { process?.terminate(); status = "Не удалось сохранить устройство в Связке ключей"; rebuildMenu(); pairingFailedIfNeeded() }
                continue
            }
            do {
                switch type {
                case "SET_THEME":
                    guard let theme = action["theme"] as? String else { throw HostError.code("REMOTE_THEME_REJECTED") }
                    try remote.setTheme(theme)
                case "GET_SCREENS": send(["id": id, "success": true, "screens": DisplayController.screens(), "localStop": pendingLocalStop, "updateHandoffFailed": pendingUpdateHandoffFailed]); pendingLocalStop = false; pendingUpdateHandoffFailed = false; continue
                case "PREPARE_DISPLAYS": try prepareFromSite()
                case "IDENTIFY_SCREENS": identification.show()
                case "RESTORE_DISPLAYS": try restoreFromSite()
                case "FOCUS_PRIVATE_REMOTE":
                    guard let origin else { throw HostError.code("REMOTE_ORIGIN_REQUIRED") }
                    try showRemote(action, origin: origin)
                case "TEST_TARGET":
                    try projection.test(screenID: action["targetScreenId"] as? String ?? "", code: action["testCode"] as? String ?? "")
                    status = "Проверка экрана"
                case "START_PUBLIC_PROJECTION":
                    guard let raw = action["url"] as? String, let url = URL(string: raw), let origin else { throw HostError.code("PUBLIC_URL_REJECTED") }
                    identification.dismiss()
                    try projection.show(screenID: action["targetScreenId"] as? String ?? "", url: url, origin: origin)
                    if action["remoteUrl"] != nil { try configureRemote(action, origin: origin, present: false) }
                    status = "Идёт показ"
                case "NEUTRAL_STOP": lastRemoteAction = nil; projection.neutralize(); remote.close(); identification.dismiss(); Task { await capture.stop() }; status = "Показ остановлен"
                case "TARGET_HELP": status = "Основной экран: выберите проектор в браузерном мастере"
                case "UPDATE_READY":
                    try beginUpdate(action)
                    send(["id": id, "success": true])
                    status = "Подготовка обновления — помощник остаётся на связи"; rebuildMenu(); return
                case "UPDATE_STATUS": status = action["testCode"] as? String == "REQUIRED" ? "Требуется обновление — доступен сайт" : "Доступно обновление после показа"
                default: throw HostError.code("UNKNOWN_NATIVE_ACTION")
                }
                send(["id": id, "success": true]); rebuildMenu()
            } catch HostError.code(let code) {
                if type != "FOCUS_PRIVATE_REMOTE" && type != "SET_THEME" { projection.close() }
                send(["id": id, "success": false, "diagnosticCode": code])
            }
            catch {
                if type != "FOCUS_PRIVATE_REMOTE" && type != "SET_THEME" { projection.close() }
                send(["id": id, "success": false, "diagnosticCode": "NATIVE_OPERATION_FAILED"])
            }
        }
    }
    private func preflightReady() -> Bool {
        guard let path = preflightPath, let id = preflightID, let nonce = preflightNonce,
              let data = try? Data(contentsOf: path), data.count <= 4096,
              let receipt = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return receipt["id"] as? String == id && receipt["nonce"] as? String == nonce && receipt["ready"] as? Bool == true
    }
    private func showRemote(_ action: [String: Any], origin: URL) throws {
        try configureRemote(action, origin: origin, present: true)
    }
    private func configureRemote(_ action: [String: Any], origin: URL, present: Bool) throws {
        guard let rawRemote = action["remoteUrl"] as? String, let remoteURL = URL(string: rawRemote),
              let rawCourse = action["courseId"] as? String, let courseID = UUID(uuidString: rawCourse),
              let rawSession = action["sessionId"] as? String, let sessionID = UUID(uuidString: rawSession),
              let token = action["controlToken"] as? String, RemoteWindow.validToken(token),
              RemoteWindow.allowed(remoteURL, origin: origin),
              RemoteWindow.matches(remoteURL, courseID: courseID, sessionID: sessionID, token: token) else { throw HostError.code("REMOTE_SCOPE_REJECTED") }
        if present { try remote.show(url: remoteURL, origin: origin) }
        capture.bind(NativeCaptureScope(origin: origin, courseID: courseID, sessionID: sessionID, token: token))
        lastRemoteAction = action
    }
    private func beginUpdate(_ action: [String: Any]) throws {
        guard !capture.isActive else { throw HostError.code("CAPTURE_ACTIVE_UPDATE_DEFERRED") }
        guard pendingUpdater == nil else { throw HostError.code("UPDATER_ALREADY_PREPARING") }
        guard let root = ProcessInfo.processInfo.environment["LA_PROJECTOR_INSTALL_ROOT"],
              let envelope = action["updateEnvelopePath"] as? String, let package = action["updatePackagePath"] as? String,
              let minimum = action["minimumVersion"] as? String else { throw HostError.code("INSTALLED_LAUNCHER_REQUIRED") }
        let rootURL = URL(fileURLWithPath: root).standardizedFileURL
        let staging = rootURL.appendingPathComponent("staging").path + "/"
        let updater = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/updater/Projector.Updater").standardizedFileURL
        guard URL(fileURLWithPath: envelope).standardizedFileURL.path.hasPrefix(staging),
              URL(fileURLWithPath: package).standardizedFileURL.path.hasPrefix(staging),
              updater.path.hasPrefix(rootURL.appendingPathComponent("versions").path + "/"),
              FileManager.default.isExecutableFile(atPath: updater.path) else { throw HostError.code("INVALID_UPDATE_HANDOFF") }
        projection.neutralize()
        let helper = Process(); helper.executableURL = updater
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
        // .NET checks identity using UTC ticks. Obtain the native start time directly without a shell.
        let ticks = try NativeProcessStartIdentity.readTicks(pid: ProcessInfo.processInfo.processIdentifier)
        helper.arguments = ["install", envelope, package, platform(), "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)", version,
                            rootURL.path, rootURL.path, minimum, String(ProcessInfo.processInfo.processIdentifier), String(ticks)]
        var environment = ProcessInfo.processInfo.environment
        for key in ["LA_PROJECTOR_UPDATE_ID", "LA_PROJECTOR_UPDATE_NONCE", "LA_PROJECTOR_HEALTH_PATH"] { environment.removeValue(forKey: key) }
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        var secret = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, secret.count, &secret) == errSecSuccess else { throw HostError.code("PREFLIGHT_NONCE_FAILED") }
        let nonce = secret.map { String(format: "%02x", $0) }.joined()
        let readyFile = rootURL.appendingPathComponent("health/preflight-" + id + ".json")
        environment["LA_PROJECTOR_PREFLIGHT_ID"] = id; environment["LA_PROJECTOR_PREFLIGHT_NONCE"] = nonce; environment["LA_PROJECTOR_PREFLIGHT_PATH"] = readyFile.path
        helper.environment = environment; helper.standardOutput = FileHandle.nullDevice; helper.standardError = FileHandle.nullDevice
        try helper.run()
        pendingUpdater = helper; preflightPath = readyFile; preflightID = id; preflightNonce = nonce
        preflightStartedAt = ProcessInfo.processInfo.systemUptime
    }
    private func send(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), let input else { return }
        do { try input.fileHandleForWriting.write(contentsOf: data + Data([10])) } catch { process?.terminate() }
    }
    @objc private func prepare() {
        do { try prepareFromSite() } catch { status = "Подготовка не удалась — используйте инструкцию на сайте"; rebuildMenu() }
    }
    private func prepareFromSite() throws {
        let alert = NSAlert(); alert.messageText = "Подготовить отдельный экран?"
        alert.informativeText = "Подключённые зеркальные дисплеи временно станут отдельными. Проектор сначала покажет только проверочный код. Исходная настройка сохранится; возврат — отдельной кнопкой после скрытия служебного окна."
        alert.addButton(withTitle: "Подготовить"); alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else { throw HostError.code("LOCAL_CONFIRMATION_CANCELLED") }
        do { projection.neutralize(); try display.prepareIndependentOutput(); status = "Выберите и проверьте экран на сайте" }
        catch HostError.code(let code) {
            status = code == "DISPLAY_RECOVERY_JOURNAL_INVALID" ? "Сохранённая настройка повреждена — используйте инструкцию на сайте" : "Сначала проверьте возврат сохранённой настройки экранов"
            rebuildMenu(); throw HostError.code(code)
        }
        catch { status = "Подготовка не удалась — используйте инструкцию на сайте"; rebuildMenu(); throw error }
        rebuildMenu()
    }
    @objc private func stop() { lastRemoteAction = nil; pendingLocalStop = true; projection.neutralize(); remote.close(); identification.dismiss(); Task { await capture.stop() }; status = "Показ остановлен локально"; rebuildMenu() }
    @objc private func restore() {
        do { try restoreFromSite() } catch { status = "Возврат не удался — используйте настройки macOS"; rebuildMenu() }
    }
    private func restoreFromSite() throws {
        projection.neutralize(); remote.close(); Task { await capture.stop() }
        let alert = NSAlert(); alert.messageText = "Вернуть исходную настройку?"
        alert.informativeText = "Сначала скройте служебное окно преподавателя. При возврате дублирования аудитория снова увидит основной экран. Настройки, изменённые вами вручную, не будут перезаписаны."
        alert.addButton(withTitle: "Служебное окно скрыто — вернуть"); alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else { throw HostError.code("LOCAL_CONFIRMATION_CANCELLED") }
        do { let result = try display.restore(locallyConfirmed: true); status = result == "RESTORED" || result == "UNCHANGED" ? "Настройка возвращена" : "Настройка изменилась — возврат пропущен"; projection.close() }
        catch { status = "Возврат не удался — используйте настройки macOS"; rebuildMenu(); throw error }
        rebuildMenu()
    }
    @objc private func toggleStartup() {
        do { startupStatus = try bootstrapCommand(startupStatus == "ENABLED" || startupStatus == "REQUIRES_APPROVAL" ? "--disable-login" : "--enable-login") }
        catch { status = "Автозапуск требует разрешения macOS" }
        rebuildMenu()
    }
    private func bootstrapExecutable() -> URL? {
        guard let path = ProcessInfo.processInfo.environment["LA_PROJECTOR_BOOTSTRAP_PATH"] else { return nil }
        let executable = URL(fileURLWithPath: path).standardizedFileURL
        let bundle = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let home = FileManager.default.homeDirectoryForCurrentUser
        guard [home.appendingPathComponent("Applications/Lecturer Projector.app").path, "/Applications/Lecturer Projector.app"].contains(bundle.path),
              executable.path == bundle.appendingPathComponent("Contents/MacOS/ProjectorBootstrap").path,
              Bundle(url: bundle)?.bundleIdentifier == "ru.university.lecturer-projector",
              FileManager.default.isExecutableFile(atPath: executable.path),
              (try? bundle.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) != true else { return nil }
        return executable
    }
    private func bootstrapCommand(_ argument: String) throws -> String {
        guard let executable = bootstrapExecutable() else { throw HostError.code("STABLE_INSTALL_REQUIRED") }
        let process = Process(); let output = Pipe()
        process.executableURL = executable; process.arguments = [argument]
        process.standardOutput = output; process.standardError = FileHandle.nullDevice
        try process.run(); let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        guard process.terminationStatus == 0, data.count <= 128 else { throw HostError.code("LOGIN_PERMISSION_REQUIRED") }
        return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    @objc private func startupHelp() {
        let alert = NSAlert(); alert.messageText = "Разрешить автозапуск"
        alert.informativeText = "Откройте Системные настройки → Основные → Объекты входа и расширения и разрешите Lecturer Projector. В macOS 14/15 раздел называется «Объекты входа». Это требуется только для запуска после входа в Mac."
        alert.runModal()
        startupStatus = (try? bootstrapCommand("--login-status")) ?? "UNAVAILABLE"; rebuildMenu()
    }
    @objc private func unpair() {
        stop(); generation = UUID(); process?.terminate()
        if let origin { Keychain.remove(account: origin.absoluteString) }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("origin.txt")); origin = nil; savedConnectionAccount = nil; savedKeychainStatus = nil
        status = "Устройство отключено. Отзовите его также на сайте."; rebuildMenu()
    }
    @objc private func help() {
        let alert = NSAlert(); alert.messageText = "Помощник проектора"
        alert.informativeText = "Помощник выводит публичную сцену и управляется сайтом/MAX. Он не захватывает экран в простое. Для удаления остановите показ, верните исходную настройку экранов и выберите «Удалить помощник…». Устройство также можно отозвать на сайте. Минимум macOS 14. Браузерный мастер работает без установки."
        alert.runModal()
    }
    @objc private func diagnostics() {
        let panel = NSSavePanel(); panel.nameFieldStringValue = "lecturer-projector-diagnostics.json"
        panel.title = "Сохранить диагностику без данных аккаунта"
        guard panel.runModal() == .OK, let destination = panel.url else { return }
        var report: [String: Any] = ["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
                                    "platform": platform(), "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
                                    "startup": startupStatus, "installed": bootstrapExecutable() != nil,
                                    "displayRecoveryPending": FileManager.default.fileExists(atPath: directory.appendingPathComponent("display-recovery.json").path)]
        if let root = ProcessInfo.processInfo.environment["LA_PROJECTOR_INSTALL_ROOT"] {
            report["updateRecoveryPending"] = FileManager.default.fileExists(atPath: URL(fileURLWithPath: root).appendingPathComponent("update-transaction.json").path)
        }
        do { try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted]).write(to: destination, options: .atomic) }
        catch { status = "Не удалось сохранить диагностику"; rebuildMenu() }
    }
    @objc private func uninstall() {
        guard pendingUpdater == nil, !FileManager.default.fileExists(atPath: directory.appendingPathComponent("display-recovery.json").path),
              let executable = bootstrapExecutable(), let rootPath = ProcessInfo.processInfo.environment["LA_PROJECTOR_INSTALL_ROOT"],
              URL(fileURLWithPath: rootPath).standardizedFileURL.path == directory.appendingPathComponent("install").standardizedFileURL.path,
              !FileManager.default.fileExists(atPath: URL(fileURLWithPath: rootPath).appendingPathComponent("update-transaction.json").path) else {
            let alert = NSAlert(); alert.messageText = "Сначала завершите подготовку"
            alert.informativeText = "Остановите показ и верните сохранённую настройку экранов. Если обновление не завершилось или приложение запущено не из установленного пакета, сохраните диагностику и обратитесь в поддержку. Нужные для восстановления файлы не удаляются."
            alert.runModal(); return
        }
        let alert = NSAlert(); alert.messageText = "Удалить помощник проектора?"
        alert.informativeText = "Показ будет остановлен, автозапуск отключён, ключ устройства удалён из Связки ключей. Приложение и установленные версии переместятся в Корзину. Отзовите устройство также на сайте. Сайт и MAX продолжат работать."
        alert.addButton(withTitle: "Удалить помощник"); alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            _ = try bootstrapCommand("--disable-login")
            let root = URL(fileURLWithPath: rootPath).standardizedFileURL
            guard (try root.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) != true else { throw HostError.code("UNSAFE_INSTALL_DIRECTORY") }
            let bundle = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            stop(); generation = UUID(); process?.terminate(); process?.waitUntilExit(); process = nil
            if instanceLock >= 0 { flock(instanceLock, LOCK_UN) }
            do {
                let check = Process(); let output = Pipe()
                check.executableURL = bundle.appendingPathComponent("Contents/MacOS/launcher/Projector.Launcher")
                check.arguments = ["uninstall-check", root.path]; check.standardOutput = output; check.standardError = output
                try check.run(); _ = output.fileHandleForReading.readDataToEndOfFile(); check.waitUntilExit()
                guard check.terminationStatus == 0 else { throw HostError.code("UNINSTALL_RECOVERY_REQUIRED") }
                guard instanceLock >= 0, flock(instanceLock, LOCK_EX | LOCK_NB) == 0 else { throw HostError.code("ANOTHER_HELPER_STARTED") }
            } catch {
                if instanceLock >= 0 { _ = flock(instanceLock, LOCK_EX | LOCK_NB) }
                throw error
            }
            unpair()
            NSWorkspace.shared.recycle([bundle, root], completionHandler: Self.recycleCompletion(for: self))
        } catch { status = "Удаление остановлено — отключите автозапуск в настройках macOS"; rebuildMenu() }
    }
    nonisolated private static func recycleCompletion(for delegate: AppDelegate) -> @Sendable ([URL: URL], (any Error)?) -> Void {
        { [weak delegate] _, error in
            let failed = error != nil
            Task { @MainActor [weak delegate] in
                if failed {
                    if let delegate, delegate.instanceLock >= 0 { _ = flock(delegate.instanceLock, LOCK_EX | LOCK_NB) }
                    delegate?.status = "Удаление не завершено — переместите приложение в Корзину"; delegate?.rebuildMenu()
                } else { NSApp.terminate(nil) }
            }
        }
    }
    @objc private func quit() { stop(); NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { projection.neutralize(); remote.close(); identification.dismiss(); process?.terminate(); if instanceLock >= 0 { close(instanceLock) } }
}

if let index = CommandLine.arguments.firstIndex(of: "--keychain-recovery-self-test"), CommandLine.arguments.count > index + 1 {
    try KeychainRecoverySelfTest.run(reportURL: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
} else if let index = CommandLine.arguments.firstIndex(of: "--capture-dialog-self-test"), CommandLine.arguments.count > index + 1 {
    CaptureDialogSelfTest.run(reportURL: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
} else if let index = CommandLine.arguments.firstIndex(of: "--process-identity-self-test"), CommandLine.arguments.count > index + 2 {
    try ProcessIdentitySelfTest.run(checksURL: URL(fileURLWithPath: CommandLine.arguments[index + 1]),
                                    reportURL: URL(fileURLWithPath: CommandLine.arguments[index + 2]))
} else if let index = CommandLine.arguments.firstIndex(of: "--identity-self-test"), CommandLine.arguments.count > index + 1 {
    try IdentitySelfTest.run(reportURL: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
} else if CommandLine.arguments.contains("--journal-self-test") {
    try JournalSelfTest.run()
} else if CommandLine.arguments.contains("--capture-self-test") {
    try CaptureSelfTest.run()
} else if let index = CommandLine.arguments.firstIndex(of: "--remote-self-test"), CommandLine.arguments.count > index + 1 {
    RemoteSelfTest.run(reportURL: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
} else if let index = CommandLine.arguments.firstIndex(of: "--connection-self-test"), CommandLine.arguments.count > index + 1 {
    ConnectionSelfTest.run(reportURL: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
} else if let index = CommandLine.arguments.firstIndex(of: "--placement-self-test"), CommandLine.arguments.count > index + 1 {
    PlacementSelfTest.run(reportURL: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
} else if let index = CommandLine.arguments.firstIndex(of: "--workspace-self-test"), CommandLine.arguments.count > index + 1 {
    WorkspaceSelfTest.run(reportURL: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
} else if CommandLine.arguments.contains("--preflight") {
    let data = try JSONSerialization.data(withJSONObject: ["platform": "macOS", "mutation": false, "screens": DisplayController.screens()], options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} else {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = AppDelegate(); app.delegate = delegate; app.run()
}
