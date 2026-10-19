import AppKit
import Foundation
import ServiceManagement
import Security
import Darwin
import CoreServices

enum BootstrapFailure: Error { case code(String) }
struct PairingRequest: Sendable { let origin: String; let code: String }

@MainActor enum Installation {
    static let name = "Lecturer Projector.app"
    static let identifier = "ru.university.lecturer-projector"
    static let installerIdentifier = identifier + ".installer"
    static let files = FileManager.default
    static var userApplication: URL { files.homeDirectoryForCurrentUser.appendingPathComponent("Applications/" + name) }
    static var data: URL { files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LecturerProjector", isDirectory: true) }
    static var root: URL { data.appendingPathComponent("install", isDirectory: true) }
    static func shouldActivateSeed(installedVersion: String?, seedVersion: String) -> Bool {
        installedVersion == nil || installedVersion!.compare(seedVersion, options: .numeric) == .orderedAscending
    }
    static func codeIdentity(_ bundle: URL) throws -> Data {
        try requirePlainDirectory(bundle)
        #if arch(arm64)
        let architecture = CPU_TYPE_ARM64
        #else
        let architecture = CPU_TYPE_X86_64
        #endif
        var code: SecStaticCode?
        let attributes = [kSecCodeAttributeArchitecture as String: NSNumber(value: architecture)] as CFDictionary
        guard SecStaticCodeCreateWithPathAndAttributes(bundle as CFURL, [], attributes, &code) == errSecSuccess, let code,
              SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode), nil) == errSecSuccess else { throw BootstrapFailure.code("APPLICATION_SIGNATURE_REJECTED") }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
              let hash = (information as? [String: Any])?[kSecCodeInfoUnique as String] as? Data, !hash.isEmpty else { throw BootstrapFailure.code("APPLICATION_IDENTITY_UNAVAILABLE") }
        return hash
    }
    static func installedMatch(runningBundle: URL, candidates: [URL]? = nil, expectedIdentifier: String = identifier) throws -> URL? {
        let runningIdentity = try codeIdentity(runningBundle)
        let runningMetadata = try readMetadata(runningBundle.appendingPathComponent("Contents/Resources/bootstrap.json"))
        var matches: [URL] = []
        for candidate in candidates ?? [userApplication, URL(fileURLWithPath: "/Applications/" + name)] {
            guard files.fileExists(atPath: candidate.path) else { continue }
            try checkParents(candidate)
            guard Bundle(url: candidate)?.bundleIdentifier == expectedIdentifier,
                  Bundle(url: candidate)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == runningMetadata["version"] as? String,
                  let metadata = try? readMetadata(candidate.appendingPathComponent("Contents/Resources/bootstrap.json")),
                  metadata["packageSha256"] as? String == runningMetadata["packageSha256"] as? String,
                  let candidateIdentity = try? codeIdentity(candidate), candidateIdentity == runningIdentity else { continue }
            matches.append(candidate.standardizedFileURL)
        }
        guard matches.count <= 1 else { throw BootstrapFailure.code("MULTIPLE_MATCHING_INSTALLATIONS") }
        return matches.first
    }
    static func requestVisibleOpen() throws {
        try checkParents(data)
        try files.createDirectory(at: data, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let file = data.appendingPathComponent("pending-open.json")
        if files.fileExists(atPath: file.path), (try file.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink == true { throw BootstrapFailure.code("UNSAFE_OPEN_REQUEST") }
        try JSONSerialization.data(withJSONObject: ["action": "show", "requestId": UUID().uuidString]).write(to: file, options: [.atomic])
        try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    static func pairingRequest(_ urls: [URL]) -> PairingRequest? {
        guard urls.count == 1, let url = urls.first, url.absoluteString.count <= 2048, url.scheme == "lecturer-projector", url.host == "pair", url.port == nil,
              url.path.isEmpty || url.path == "/", url.user == nil, url.password == nil, url.fragment == nil,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), let items = parts.queryItems,
              items.count == 2, Set(items.map(\.name)) == ["origin", "code"],
              let origin = items.first(where: { $0.name == "origin" })?.value,
              let site = URLComponents(string: origin), site.scheme == "https", site.host != nil,
              site.user == nil, site.password == nil, (site.path.isEmpty || site.path == "/"), site.query == nil, site.fragment == nil,
              let code = items.first(where: { $0.name == "code" })?.value, code.count == 12,
              code.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) }) else { return nil }
        return PairingRequest(origin: origin, code: code)
    }
    static func writePairingRequest(_ request: PairingRequest, directory: URL? = nil) throws {
        let destination = directory ?? data
        try checkParents(destination)
        try files.createDirectory(at: destination, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let file = destination.appendingPathComponent("pending-pair.json")
        if files.fileExists(atPath: file.path), (try file.resourceValues(forKeys: [.isSymbolicLinkKey])).isSymbolicLink == true { throw BootstrapFailure.code("UNSAFE_PAIR_REQUEST") }
        try JSONSerialization.data(withJSONObject: ["origin": request.origin, "code": request.code]).write(to: file, options: [.atomic])
        try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        try? files.removeItem(at: destination.appendingPathComponent("pending-open.json"))
    }
    static func isStable(_ bundle: URL, home: URL = files.homeDirectoryForCurrentUser) -> Bool {
        let path = bundle.standardizedFileURL.path
        return path == home.appendingPathComponent("Applications/" + name).standardizedFileURL.path || path == "/Applications/" + name
    }
    static func requirePlainDirectory(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw BootstrapFailure.code("UNSAFE_INSTALL_DIRECTORY") }
    }
    static func checkParents(_ url: URL) throws {
        var item = url.standardizedFileURL
        while item.path != "/" {
            if files.fileExists(atPath: item.path) { try requirePlainDirectory(item) }
            item.deleteLastPathComponent()
        }
    }
    static func readMetadata(_ url: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: url)
        guard data.count <= 8192, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = value["version"] as? String, version.split(separator: ".").count == 3,
              version.utf8.allSatisfy({ (48...57).contains($0) || $0 == 46 }),
              let platform = value["platform"] as? String, ["MACOS_ARM64", "MACOS_X64"].contains(platform),
              value["entryPoint"] as? String == "Lecturer Projector Host.app/Contents/MacOS/ProjectorMac",
              let hash = value["packageSha256"] as? String, hash.count == 64, hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              let size = value["packageSize"] as? Int, size > 0, size <= 536_870_912,
              value["minimumOsVersion"] as? String == "14.0", value["protocolVersion"] as? Int == 1 else { throw BootstrapFailure.code("INVALID_BOOTSTRAP_METADATA") }
        #if arch(arm64)
        guard platform == "MACOS_ARM64" else { throw BootstrapFailure.code("WRONG_ARCHITECTURE") }
        #else
        guard platform == "MACOS_X64" else { throw BootstrapFailure.code("WRONG_ARCHITECTURE") }
        #endif
        return value
    }
    static func run(_ executable: URL, _ arguments: [String], environment: [String: String]? = nil) throws -> String {
        guard files.isExecutableFile(atPath: executable.path) else { throw BootstrapFailure.code("LAUNCHER_MISSING") }
        let process = Process(); let output = Pipe()
        process.executableURL = executable; process.arguments = arguments
        process.standardOutput = output; process.standardError = output
        process.environment = environment
        try process.run()
        let result = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard result.count <= 65536 else { throw BootstrapFailure.code("LAUNCHER_OUTPUT_LIMIT") }
        let text = String(decoding: result, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard process.terminationStatus == 0 else {
            let code = text.split(whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? "INSTALLATION_FAILED"
            throw BootstrapFailure.code(code.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 95 }) ? code : "INSTALLATION_FAILED")
        }
        return text
    }
    static func verifyInstalledHost(stableBundle: URL) throws {
        let pointer = try Data(contentsOf: root.appendingPathComponent("current.json"))
        guard pointer.count <= 8192, let current = try JSONSerialization.jsonObject(with: pointer) as? [String: Any],
              let slot = current["slot"] as? String, !slot.isEmpty, slot.count <= 100, !slot.contains(".."),
              slot.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 46 }),
              current["entryPoint"] as? String == "Lecturer Projector Host.app/Contents/MacOS/ProjectorMac" else { throw BootstrapFailure.code("BAD_CURRENT_POINTER") }
        let host = root.appendingPathComponent("versions/" + slot + "/Lecturer Projector Host.app")
        try checkParents(host)
        var stable: SecStaticCode?
        guard SecStaticCodeCreateWithPath(stableBundle as CFURL, [], &stable) == errSecSuccess, let stable else { throw BootstrapFailure.code("SIGNATURE_UNAVAILABLE") }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(stable, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess else { throw BootstrapFailure.code("SIGNATURE_UNAVAILABLE") }
        let team = (information as? [String: Any])?[kSecCodeInfoTeamIdentifier as String] as? String
        if let team, !team.isEmpty {
            guard team.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) }) else { throw BootstrapFailure.code("INVALID_SIGNING_TEAM") }
            var requirement: SecRequirement?
            let expression = "anchor apple generic and certificate leaf[subject.OU] = \"" + team + "\""
            guard SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess else { throw BootstrapFailure.code("INVALID_SIGNING_REQUIREMENT") }
            var candidate: SecStaticCode?
            guard SecStaticCodeCreateWithPath(host as CFURL, [], &candidate) == errSecSuccess, let candidate,
                  SecStaticCodeCheckValidity(candidate, SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode), requirement) == errSecSuccess else { throw BootstrapFailure.code("INSTALLED_SIGNATURE_REJECTED") }
        } else if Bundle(url: stableBundle)?.object(forInfoDictionaryKey: "LAReleaseMode") as? String != "development" {
            throw BootstrapFailure.code("DEVELOPER_ID_REQUIRED")
        }
    }
    static func selfTest() throws {
        let fixture = files.temporaryDirectory.appendingPathComponent("projector-bootstrap-" + UUID().uuidString, isDirectory: true)
        try files.createDirectory(at: fixture, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: fixture) }
        guard shouldActivateSeed(installedVersion: nil, seedVersion: "0.2.0"),
              shouldActivateSeed(installedVersion: "0.1.1", seedVersion: "0.2.0"),
              !shouldActivateSeed(installedVersion: "0.2.0", seedVersion: "0.2.0"),
              !shouldActivateSeed(installedVersion: "0.3.0", seedVersion: "0.2.0") else { throw BootstrapFailure.code("SEED_UPGRADE_OR_DOWNGRADE_CHECK_FAILED") }
        let home = fixture.appendingPathComponent("home")
        guard isStable(home.appendingPathComponent("Applications/" + name), home: home),
              isStable(URL(fileURLWithPath: "/Applications/" + name), home: home),
              !isStable(fixture.appendingPathComponent(name), home: home),
              !isStable(home.appendingPathComponent("Applications/Other.app"), home: home) else { throw BootstrapFailure.code("STABLE_PATH_CHECK_FAILED") }
        let link = fixture.appendingPathComponent("link")
        try files.createSymbolicLink(at: link, withDestinationURL: fixture)
        do { try requirePlainDirectory(link); throw BootstrapFailure.code("SYMLINK_GUARD_MISSING") }
        catch BootstrapFailure.code(let code) { guard code == "UNSAFE_INSTALL_DIRECTORY" else { throw BootstrapFailure.code(code) } }
        let metadata = fixture.appendingPathComponent("metadata.json")
        try Data("{}".utf8).write(to: metadata)
        do { _ = try readMetadata(metadata); throw BootstrapFailure.code("METADATA_GUARD_MISSING") }
        catch BootstrapFailure.code(let code) { guard code == "INVALID_BOOTSTRAP_METADATA" else { throw BootstrapFailure.code(code) } }
        print("PASS stable installation paths, symlink/malformed metadata guards, newer manual seed activation and no login downgrade; only temporary fixtures; no UI/login/Keychain/display changes")
    }
}

@MainActor final class BootstrapDelegate: NSObject, NSApplicationDelegate {
    private var launcher: Process?
    private var startupLock: Int32 = -1
    private var quietLaunch = false
    private var lastPairRequest = Date.distantPast
    private var canonicalBundle: URL?
    private var handlerRepairPending = false
    private var extractedPayload: URL?
    func applicationWillFinishLaunching(_ notification: Notification) { detectQuietLaunch() }
    private func detectQuietLaunch() {
        let launch = NSAppleEventManager.shared().currentAppleEvent?.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue
        quietLaunch = quietLaunch || launch == keyAELaunchedAsLogInItem || launch == keyAELaunchedAsServiceItem
    }
    private func openFromUser(terminateAfter: Bool = false) {
        guard !handlerRepairPending, let target = canonicalBundle else { return }
        handlerRepairPending = true
        Task { @MainActor in
            do { try await PairingURLRegistration.ensureInstalled(target) }
            catch BootstrapFailure.code(let code) { Self.showError(code) }
            catch { Self.showError("PAIR_HANDLER_REGISTRATION_FAILED") }
            try? await Task.sleep(for: .milliseconds(800))
            handlerRepairPending = false
            if Date().timeIntervalSince(lastPairRequest) > 2 {
                do { try Installation.requestVisibleOpen() } catch { Self.showError("VISIBLE_OPEN_FAILED") }
            }
            if terminateAfter { NSApp.terminate(nil) }
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openFromUser(); return true
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let request = Installation.pairingRequest(urls) else { return }
        lastPairRequest = Date()
        do { try Installation.writePairingRequest(request) } catch { Self.showError("PAIR_LINK_FAILED") }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            detectQuietLaunch()
            let running = Bundle.main.bundleURL
            if Bundle.main.bundleIdentifier == Installation.installerIdentifier {
                let stage = Installation.data.appendingPathComponent(".installer-payloads.noindex/" + UUID().uuidString)
                extractedPayload = stage
                let payload = try InstallerPayload.extract(from: running, into: stage)
                try install(from: payload); return
            }
            guard Bundle.main.bundleIdentifier == Installation.identifier else { throw BootstrapFailure.code("INVALID_APPLICATION_BUNDLE") }
            guard let bundle = try Installation.installedMatch(runningBundle: running) else { try install(from: running); return }
            canonicalBundle = bundle
            try Installation.checkParents(Installation.data)
            try Installation.files.createDirectory(at: Installation.data, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            startupLock = open(Installation.data.appendingPathComponent("bootstrap.lock").path, O_CREAT | O_RDWR, 0o600)
            guard startupLock >= 0, flock(startupLock, LOCK_EX | LOCK_NB) == 0 else {
                if !quietLaunch { openFromUser(terminateAfter: true) }
                else { NSApp.terminate(nil) }
                return
            }
            let resources = bundle.appendingPathComponent("Contents/Resources")
            let seed = try Installation.readMetadata(resources.appendingPathComponent("bootstrap.json"))
            let executable = bundle.appendingPathComponent("Contents/MacOS/launcher/Projector.Launcher")
            var environment = ProcessInfo.processInfo.environment
            environment["LA_PROJECTOR_BOOTSTRAP_PATH"] = bundle.appendingPathComponent("Contents/MacOS/ProjectorBootstrap").path
            for key in ["LA_PROJECTOR_UPDATE_ID", "LA_PROJECTOR_UPDATE_NONCE", "LA_PROJECTOR_HEALTH_PATH", "LA_PROJECTOR_PREFLIGHT_ID", "LA_PROJECTOR_PREFLIGHT_NONCE", "LA_PROJECTOR_PREFLIGHT_PATH"] { environment.removeValue(forKey: key) }
            // A newer explicitly installed app may contain a newer sealed seed. Never downgrade
            // an online-updated host, and never run installation guards during an unchanged login.
            let pointer = Installation.root.appendingPathComponent("current.json")
            let installed = (try? Data(contentsOf: pointer)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let oldVersion = installed?["version"] as? String
            let newVersion = seed["version"] as! String
            if Installation.shouldActivateSeed(installedVersion: oldVersion, seedVersion: newVersion) {
                _ = try Installation.run(executable, ["bootstrap", Installation.root.path, resources.appendingPathComponent("seed.zip").path, resources.appendingPathComponent("bootstrap.json").path], environment: environment)
            }
            try Installation.verifyInstalledHost(stableBundle: bundle)
            let process = Process(); process.executableURL = executable; process.arguments = [Installation.root.path]
            process.environment = environment; process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
            process.terminationHandler = { process in
                let code = process.terminationStatus
                Task { @MainActor in
                    if code != 0 { Self.showError("LAUNCH_FAILED") }
                    NSApp.terminate(nil)
                }
            }
            try process.run(); launcher = process
            if !quietLaunch { openFromUser() }
        } catch BootstrapFailure.code(let code) { Self.showError(code); NSApp.terminate(nil) }
        catch { Self.showError("INSTALLATION_FAILED"); NSApp.terminate(nil) }
    }
    private func install(from bundle: URL) throws {
        let target = Installation.userApplication
        let exists = Installation.files.fileExists(atPath: target.path)
        let installedVersion = Bundle(url: target)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let candidateVersion = Bundle(url: bundle)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let upgrade = exists && installedVersion.compare(candidateVersion, options: .numeric) == .orderedAscending
        let alert = NSAlert(); alert.messageText = upgrade ? "Обновить помощник до " + candidateVersion + "?" : (exists ? "Помощник уже установлен" : "Установить помощник проектора?")
        alert.informativeText = upgrade ? "Помощник будет обновлён. Если сейчас идёт показ, сначала завершите его и закройте помощник. Подключение учреждения и настройки сохранятся." : (exists ? "Откроется установленный помощник и окно подключения. Возьмите 12-символьный код помощника в «Настройке проектора» на сайте — не код занятия со слайда." : "Приложение будет скопировано в «Приложения» вашей учётной записи. Затем откроется форма адреса сайта и 12-символьного кода помощника. Автозапуск можно включить отдельно в меню LA.")
        alert.addButton(withTitle: upgrade ? "Обновить" : (exists ? "Открыть установленный" : "Установить в мои Приложения")); alert.addButton(withTitle: "Отмена")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { NSApp.terminate(nil); return }
        if exists {
            try Installation.requirePlainDirectory(target)
            guard Bundle(url: target)?.bundleIdentifier == Installation.identifier else { throw BootstrapFailure.code("INSTALLATION_NAME_IN_USE") }
        }
        if !exists || upgrade {
            let parent = target.deletingLastPathComponent()
            try Installation.checkParents(parent)
            try Installation.files.createDirectory(at: parent, withIntermediateDirectories: true)
            let temporary = parent.appendingPathComponent(".LecturerProjector-" + UUID().uuidString + ".app")
            defer { try? Installation.files.removeItem(at: temporary) }
            if upgrade {
                let resources = bundle.appendingPathComponent("Contents/Resources")
                _ = try Installation.run(bundle.appendingPathComponent("Contents/MacOS/launcher/Projector.Launcher"), ["bootstrap-check", Installation.root.path, resources.appendingPathComponent("bootstrap.json").path])
            }
            try Installation.files.copyItem(at: bundle, to: temporary)
            if exists {
                let backup = parent.appendingPathComponent(".LecturerProjector-previous-" + UUID().uuidString + ".app")
                try Installation.files.moveItem(at: target, to: backup)
                do { try Installation.files.moveItem(at: temporary, to: target) }
                catch { try? Installation.files.moveItem(at: backup, to: target); throw error }
                try? Installation.files.removeItem(at: backup)
            } else { try Installation.files.moveItem(at: temporary, to: target) }
        }
        Task { @MainActor in
            do {
                _ = try await WorkspaceHandoff.open(target: target)
            } catch BootstrapFailure.code(let code) { Self.showError(code) }
            catch { Self.showError("START_INSTALLED_APPLICATION_FAILED") }
            NSApp.terminate(nil)
        }
    }
    private static func showError(_ code: String) {
        let alert = NSAlert(); alert.messageText = code.hasPrefix("PAIR_HANDLER_") ? "Открытие по ссылке не настроено" : "Помощник не запущен"
        let explanation: String
        switch code {
        case "PAIR_HANDLER_REGISTRATION_FAILED", "PAIR_HANDLER_SELECTION_DENIED", "PAIR_HANDLER_SELECTION_UNVERIFIED", "PAIR_HANDLER_UNSAFE_TARGET", "PAIR_HANDLER_UNDECLARED_SCHEME": explanation = "macOS не связала ссылки сайта с установленным помощником. Откройте Lecturer Projector из ваших «Приложений» и повторите. Подключение вручную по 12-символьному коду доступно в настройке проектора на сайте. Другие приложения и настройки экранов не изменены."
        case "MULTIPLE_MATCHING_INSTALLATIONS": explanation = "Найдены две одинаковые установки: в ваших «Приложениях» и общих /Applications. Оставьте одну установку и откройте её снова. Помощник не выбирает копию за вас."
        case "UPDATE_RECOVERY_REQUIRED": explanation = "Предыдущее обновление не завершилось. Не удаляйте сохранённые файлы вручную: передайте код в поддержку. Браузерный мастер доступен."
        case "HELPER_RUNNING", "INSTALLATION_BUSY", "ACTIVE_SHOW", "SHOW_ACTIVE", "AGENT_RUNNING", "INSTALL_INSTANCE_ACTIVE": explanation = "Помощник уже запущен: найдите значок LA в строке меню. Перед переустановкой завершите показ и выйдите из помощника."
        case "DISPLAY_RECOVERY_REQUIRED": explanation = "Сохранена прежняя настройка экранов. Если значок LA уже есть в строке меню, выберите там «Вернуть настройку экранов…». Иначе верните режим через настройки macOS по инструкции сайта; не удаляйте журнал восстановления вручную."
        default: explanation = "Используйте браузерный мастер «Настройка проектора». Для поддержки сохраните код ошибки. Настройки экранов не изменены."
        }
        alert.informativeText = explanation + "\n\nКод: " + code
        NSApp.activate(ignoringOtherApps: true); alert.runModal()
    }
    func applicationWillTerminate(_ notification: Notification) {
        if let extractedPayload { try? Installation.files.removeItem(at: extractedPayload) }
        if startupLock >= 0 { close(startupLock) }
    }
}

if CommandLine.arguments.contains("--self-test") {
    try Installation.selfTest()
} else if let index = CommandLine.arguments.firstIndex(of: "--installer-self-test"), CommandLine.arguments.count > index + 3 {
    InstallerPayload.selfTest(installer: URL(fileURLWithPath: CommandLine.arguments[index + 1]), report: URL(fileURLWithPath: CommandLine.arguments[index + 2]), referenceCanonical: URL(fileURLWithPath: CommandLine.arguments[index + 3]))
} else if let index = CommandLine.arguments.firstIndex(of: "--handoff-self-test"), CommandLine.arguments.count > index + 1 {
    HandoffSelfTest.run(report: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
} else if let index = CommandLine.arguments.firstIndex(of: "--handoff-fixture-child"), CommandLine.arguments.count > index + 1 {
    HandoffFixtureChild.run(report: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
} else if let report = HandoffFixtureChild.automaticReport() {
    HandoffFixtureChild.run(report: report)
} else if CommandLine.arguments.contains("--login-status") || CommandLine.arguments.contains("--enable-login") || CommandLine.arguments.contains("--disable-login") {
    guard Bundle.main.bundleIdentifier == Installation.identifier,
          (try? Installation.installedMatch(runningBundle: Bundle.main.bundleURL)) != nil else { FileHandle.standardError.write(Data("STABLE_INSTALL_REQUIRED\n".utf8)); exit(1) }
    do {
        if CommandLine.arguments.contains("--enable-login") { try SMAppService.mainApp.register() }
        if CommandLine.arguments.contains("--disable-login"), SMAppService.mainApp.status != .notRegistered, SMAppService.mainApp.status != .notFound { try SMAppService.mainApp.unregister() }
        switch SMAppService.mainApp.status {
        case .enabled: print("ENABLED")
        case .requiresApproval: print("REQUIRES_APPROVAL")
        case .notRegistered: print("DISABLED")
        case .notFound: print("NOT_FOUND")
        @unknown default: print("UNAVAILABLE")
        }
    } catch { FileHandle.standardError.write(Data("LOGIN_PERMISSION_REQUIRED\n".utf8)); exit(1) }
} else {
    let app = NSApplication.shared; app.setActivationPolicy(.accessory)
    let delegate = BootstrapDelegate(); app.delegate = delegate; app.run()
}
