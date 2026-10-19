import AppKit
import Foundation
import Security
import ServiceManagement
import Darwin

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private let projection = ProjectionWindow()
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

    func applicationDidFinishLaunching(_ notification: Notification) {
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LecturerProjector", isDirectory: true)
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { NSApp.terminate(nil); return }
        instanceLock = open(directory.appendingPathComponent("instance.lock").path, O_CREAT | O_RDWR, 0o600)
        guard instanceLock >= 0, flock(instanceLock, LOCK_EX | LOCK_NB) == 0 else { NSApp.terminate(nil); return }
        display = DisplayController(directory: directory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "LA"
        rebuildMenu()
        updateStopTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
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
            Task { @MainActor in self?.projection.neutralize(); self?.status = "Экраны изменились — повторите проверку"; self?.rebuildMenu() }
        }
        let config = directory.appendingPathComponent("origin.txt")
        if let saved = try? String(contentsOf: config, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           let url = Self.validOrigin(saved), let token = Keychain.read(account: saved) {
            origin = url; start(origin: url, token: token, pairingCode: nil)
        }
        // Recovery journal is never applied silently at login: the teacher may have changed the display setup meanwhile.
        if FileManager.default.fileExists(atPath: directory.appendingPathComponent("display-recovery.json").path) {
            status = "Есть сохранённая настройка экранов — проверьте возврат"; rebuildMenu()
        }
    }
    private func rebuildMenu() {
        let menu = NSMenu()
        let label = NSMenuItem(title: status, action: nil, keyEquivalent: ""); label.isEnabled = false; menu.addItem(label)
        add(menu, "Подключить к учреждению…", #selector(pair))
        add(menu, "Подготовить отдельный экран…", #selector(prepare))
        add(menu, "Остановить показ", #selector(stop))
        add(menu, "Вернуть настройку экранов…", #selector(restore))
        let startup = NSMenuItem(title: "Запускать при входе", action: #selector(toggleStartup), keyEquivalent: "")
        startup.target = self; startup.state = SMAppService.mainApp.status == .enabled ? .on : .off; menu.addItem(startup)
        add(menu, "Отключить устройство…", #selector(unpair))
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
        projection.neutralize()
        let alert = NSAlert(); alert.messageText = "Подключить проектор"
        alert.informativeText = "Откройте «Настройка проектора» на сайте учреждения. Введите адрес сайта и одноразовый код. Пароль аккаунта не нужен."
        let stack = NSStackView(); stack.orientation = .vertical; stack.spacing = 8
        let address = NSTextField(string: origin?.absoluteString ?? ""); address.placeholderString = "https://адрес-учреждения/"
        let code = NSTextField(string: ""); code.placeholderString = "Одноразовый код устройства"
        for field in [address, code] { field.frame.size = NSSize(width: 380, height: 28); stack.addArrangedSubview(field) }
        stack.frame = NSRect(x: 0, y: 0, width: 380, height: 70); alert.accessoryView = stack
        alert.addButton(withTitle: "Подключить"); alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn, let url = Self.validOrigin(address.stringValue), !code.stringValue.isEmpty else { return }
        origin = url; start(origin: url, token: nil, pairingCode: code.stringValue)
    }
    private static func validOrigin(_ text: String) -> URL? {
        guard let components = URLComponents(string: text), components.scheme == "https", components.host != nil,
              components.user == nil, components.password == nil, (components.path == "" || components.path == "/"),
              components.query == nil, components.fragment == nil else { return nil }
        return URL(string: components.string!.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/")
    }
    private func start(origin: URL, token: String?, pairingCode: String?) {
        generation = UUID(); let currentGeneration = generation
        process?.terminate(); projection.neutralize(); pending.removeAll()
        let coordinator = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/coordinator/Projector.Agent")
        guard FileManager.default.isExecutableFile(atPath: coordinator.path) else { status = "Компонент сборки отсутствует — используйте сайт"; rebuildMenu(); return }
        let process = Process(); let input = Pipe(); let output = Pipe()
        process.executableURL = coordinator; process.arguments = ["--native-stdio"]
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor in guard self?.generation == currentGeneration else { return }; self?.receive(data) }
        }
        process.terminationHandler = { [weak self] _ in Task { @MainActor in guard self?.generation == currentGeneration else { return }; self?.projection.neutralize(); self?.status = "Связь остановлена — используйте сайт"; self?.rebuildMenu() } }
        do {
            try process.run(); self.process = process; self.input = input
            var bootstrap: [String: Any] = ["origin": origin.absoluteString, "name": Host.current().localizedName ?? "Mac", "platform": platform()]
            if let token { bootstrap["deviceToken"] = token }
            if let pairingCode { bootstrap["pairingCode"] = pairingCode }
            send(bootstrap); status = "Подключение…"; rebuildMenu()
        } catch { status = "Не удалось запустить компонент"; rebuildMenu() }
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
                    status = "Готов — управление на сайте"; rebuildMenu()
                } catch { process?.terminate(); status = "Не удалось сохранить устройство в Связке ключей"; rebuildMenu() }
                continue
            }
            do {
                switch type {
                case "GET_SCREENS": send(["id": id, "success": true, "screens": DisplayController.screens(), "localStop": pendingLocalStop, "updateHandoffFailed": pendingUpdateHandoffFailed]); pendingLocalStop = false; pendingUpdateHandoffFailed = false; continue
                case "TEST_TARGET":
                    try projection.test(screenID: action["targetScreenId"] as? String ?? "", code: action["testCode"] as? String ?? "")
                    status = "Проверка экрана"
                case "START_PUBLIC_PROJECTION":
                    guard let raw = action["url"] as? String, let url = URL(string: raw), let origin else { throw HostError.code("PUBLIC_URL_REJECTED") }
                    try projection.show(screenID: action["targetScreenId"] as? String ?? "", url: url, origin: origin); status = "Идёт показ"
                case "NEUTRAL_STOP": projection.neutralize(); status = "Показ остановлен"
                case "TARGET_HELP": status = "Основной экран: выберите проектор в браузерном мастере"
                case "UPDATE_READY":
                    try beginUpdate(action)
                    send(["id": id, "success": true])
                    status = "Подготовка обновления — помощник остаётся на связи"; rebuildMenu(); return
                case "UPDATE_STATUS": status = action["testCode"] as? String == "REQUIRED" ? "Требуется обновление — доступен сайт" : "Доступно обновление после показа"
                default: throw HostError.code("UNKNOWN_NATIVE_ACTION")
                }
                send(["id": id, "success": true]); rebuildMenu()
            } catch HostError.code(let code) { projection.neutralize(); send(["id": id, "success": false, "diagnosticCode": code]) }
            catch { projection.neutralize(); send(["id": id, "success": false, "diagnosticCode": "NATIVE_OPERATION_FAILED"]) }
        }
    }
    private func preflightReady() -> Bool {
        guard let path = preflightPath, let id = preflightID, let nonce = preflightNonce,
              let data = try? Data(contentsOf: path), data.count <= 4096,
              let receipt = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return receipt["id"] as? String == id && receipt["nonce"] as? String == nonce && receipt["ready"] as? Bool == true
    }
    private func beginUpdate(_ action: [String: Any]) throws {
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
        var processInfo = proc_bsdinfo()
        let size = proc_pidinfo(ProcessInfo.processInfo.processIdentifier, PROC_PIDTBSDINFO, 0, &processInfo, Int32(MemoryLayout<proc_bsdinfo>.size))
        guard size == MemoryLayout<proc_bsdinfo>.size else { throw HostError.code("PROCESS_IDENTITY_UNAVAILABLE") }
        let ticks = UInt64(processInfo.pbi_start_tvsec) * 10_000_000 + UInt64(processInfo.pbi_start_tvusec) * 10 + 621_355_968_000_000_000
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
        let alert = NSAlert(); alert.messageText = "Подготовить отдельный экран?"
        alert.informativeText = "Подключённые зеркальные дисплеи временно станут отдельными. Проектор сначала покажет только проверочный код. Исходная настройка сохранится; возврат — отдельной кнопкой после скрытия служебного окна."
        alert.addButton(withTitle: "Подготовить"); alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do { projection.neutralize(); try display.prepareIndependentOutput(); status = "Выберите и проверьте экран на сайте" }
        catch HostError.code(let code) {
            status = code == "DISPLAY_RECOVERY_JOURNAL_INVALID" ? "Сохранённая настройка повреждена — используйте инструкцию на сайте" : "Сначала проверьте возврат сохранённой настройки экранов"
        }
        catch { status = "Подготовка не удалась — используйте инструкцию на сайте" }
        rebuildMenu()
    }
    @objc private func stop() { pendingLocalStop = true; projection.neutralize(); status = "Показ остановлен локально"; rebuildMenu() }
    @objc private func restore() {
        projection.neutralize()
        let alert = NSAlert(); alert.messageText = "Вернуть исходную настройку?"
        alert.informativeText = "Сначала скройте служебное окно преподавателя. При возврате дублирования аудитория снова увидит основной экран. Настройки, изменённые вами вручную, не будут перезаписаны."
        alert.addButton(withTitle: "Служебное окно скрыто — вернуть"); alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do { let result = try display.restore(locallyConfirmed: true); status = result == "RESTORED" || result == "UNCHANGED" ? "Настройка возвращена" : "Настройка изменилась — возврат пропущен"; projection.close() }
        catch { status = "Возврат не удался — используйте настройки macOS" }
        rebuildMenu()
    }
    @objc private func toggleStartup() {
        do { if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() } }
        catch { status = "Автозапуск требует разрешения macOS" }
        rebuildMenu()
    }
    @objc private func unpair() {
        stop(); generation = UUID(); process?.terminate()
        if let origin { Keychain.remove(account: origin.absoluteString) }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("origin.txt")); origin = nil
        status = "Устройство отключено. Отзовите его также на сайте."; rebuildMenu()
    }
    @objc private func help() {
        let alert = NSAlert(); alert.messageText = "Помощник проектора"
        alert.informativeText = "Для удаления: остановите показ, верните экраны, отключите «Запускать при входе», отключите устройство и переместите приложение в Корзину. Минимум macOS 14. Браузерный мастер работает без помощника. Сборка прототипа пока не является подписанным установщиком."
        alert.runModal()
    }
    @objc private func quit() { stop(); NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { projection.neutralize(); process?.terminate(); if instanceLock >= 0 { close(instanceLock) } }
}

enum Keychain {
    static let service = "ru.university.lecturer-projector"
    static func read(account: String) -> String? {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func store(_ token: String, account: String) throws {
        remove(account: account)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                  kSecAttrAccount as String: account, kSecValueData as String: Data(token.utf8),
                                  kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw HostError.code("KEYCHAIN_WRITE_FAILED") }
    }
    static func remove(account: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
    }
}

if CommandLine.arguments.contains("--journal-self-test") {
    try JournalSelfTest.run()
} else if CommandLine.arguments.contains("--preflight") {
    let data = try JSONSerialization.data(withJSONObject: ["platform": "macOS", "mutation": false, "screens": DisplayController.screens()], options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} else {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = AppDelegate(); app.delegate = delegate; app.run()
}
