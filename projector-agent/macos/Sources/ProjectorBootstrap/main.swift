import AppKit
import Foundation
import ServiceManagement
import Security
import Darwin

enum BootstrapFailure: Error { case code(String) }

@MainActor enum Installation {
    static let name = "Lecturer Projector.app"
    static let identifier = "ru.university.lecturer-projector"
    static let files = FileManager.default
    static var userApplication: URL { files.homeDirectoryForCurrentUser.appendingPathComponent("Applications/" + name) }
    static var data: URL { files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LecturerProjector", isDirectory: true) }
    static var root: URL { data.appendingPathComponent("install", isDirectory: true) }
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
        print("PASS stable installation paths, symlink rejection and malformed metadata; only temporary fixtures; no UI/login/Keychain/display changes")
    }
}

@MainActor final class BootstrapDelegate: NSObject, NSApplicationDelegate {
    private var launcher: Process?
    private var startupLock: Int32 = -1
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let bundle = Bundle.main.bundleURL
            guard Bundle.main.bundleIdentifier == Installation.identifier else { throw BootstrapFailure.code("INVALID_APPLICATION_BUNDLE") }
            if !Installation.isStable(bundle) { try install(from: bundle); return }
            try Installation.checkParents(Installation.data)
            try Installation.files.createDirectory(at: Installation.data, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            startupLock = open(Installation.data.appendingPathComponent("bootstrap.lock").path, O_CREAT | O_RDWR, 0o600)
            guard startupLock >= 0, flock(startupLock, LOCK_EX | LOCK_NB) == 0 else { NSApp.terminate(nil); return }
            let resources = bundle.appendingPathComponent("Contents/Resources")
            _ = try Installation.readMetadata(resources.appendingPathComponent("bootstrap.json"))
            let executable = bundle.appendingPathComponent("Contents/MacOS/launcher/Projector.Launcher")
            var environment = ProcessInfo.processInfo.environment
            environment["LA_PROJECTOR_BOOTSTRAP_PATH"] = bundle.appendingPathComponent("Contents/MacOS/ProjectorBootstrap").path
            for key in ["LA_PROJECTOR_UPDATE_ID", "LA_PROJECTOR_UPDATE_NONCE", "LA_PROJECTOR_HEALTH_PATH", "LA_PROJECTOR_PREFLIGHT_ID", "LA_PROJECTOR_PREFLIGHT_NONCE", "LA_PROJECTOR_PREFLIGHT_PATH"] { environment.removeValue(forKey: key) }
            // A normal login must open the existing recovery menu, even with a display journal.
            // Only a first installation activates the sealed seed and changes current.json.
            if !Installation.files.fileExists(atPath: Installation.root.appendingPathComponent("current.json").path) {
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
        } catch BootstrapFailure.code(let code) { Self.showError(code); NSApp.terminate(nil) }
        catch { Self.showError("INSTALLATION_FAILED"); NSApp.terminate(nil) }
    }
    private func install(from bundle: URL) throws {
        let target = Installation.userApplication
        let exists = Installation.files.fileExists(atPath: target.path)
        let alert = NSAlert(); alert.messageText = exists ? "Помощник уже установлен" : "Установить помощник проектора?"
        alert.informativeText = exists ? "Откроется установленное приложение. Обновления проверяются отдельно и не прерывают показ." : "Приложение будет скопировано в «Приложения» вашей учётной записи. Сайт и MAX продолжат работать без него. Автозапуск можно включить отдельно в меню помощника."
        alert.addButton(withTitle: exists ? "Открыть установленный" : "Установить в мои Приложения"); alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else { NSApp.terminate(nil); return }
        if exists {
            try Installation.requirePlainDirectory(target)
            guard Bundle(url: target)?.bundleIdentifier == Installation.identifier else { throw BootstrapFailure.code("INSTALLATION_NAME_IN_USE") }
        } else {
            let parent = target.deletingLastPathComponent()
            try Installation.checkParents(parent)
            try Installation.files.createDirectory(at: parent, withIntermediateDirectories: true)
            let temporary = parent.appendingPathComponent(".LecturerProjector-" + UUID().uuidString + ".app")
            defer { try? Installation.files.removeItem(at: temporary) }
            try Installation.files.copyItem(at: bundle, to: temporary)
            try Installation.files.moveItem(at: temporary, to: target)
        }
        let configuration = NSWorkspace.OpenConfiguration(); configuration.activates = false
        configuration.allowsRunningApplicationSubstitution = false
        NSWorkspace.shared.openApplication(at: target, configuration: configuration) { _, error in
            let failed = error != nil
            Task { @MainActor in if failed { Self.showError("START_INSTALLED_APPLICATION_FAILED") }; NSApp.terminate(nil) }
        }
    }
    private static func showError(_ code: String) {
        let alert = NSAlert(); alert.messageText = "Помощник не запущен"
        let explanation: String
        switch code {
        case "UPDATE_RECOVERY_REQUIRED": explanation = "Предыдущее обновление не завершилось. Не удаляйте сохранённые файлы вручную: передайте код в поддержку. Браузерный мастер доступен."
        case "HELPER_RUNNING", "INSTALLATION_BUSY", "ACTIVE_SHOW", "SHOW_ACTIVE", "AGENT_RUNNING", "INSTALL_INSTANCE_ACTIVE": explanation = "Помощник уже запущен: найдите значок LA в строке меню. Перед переустановкой завершите показ и выйдите из помощника."
        case "DISPLAY_RECOVERY_REQUIRED": explanation = "Сохранена прежняя настройка экранов. Если значок LA уже есть в строке меню, выберите там «Вернуть настройку экранов…». Иначе верните режим через настройки macOS по инструкции сайта; не удаляйте журнал восстановления вручную."
        default: explanation = "Используйте браузерный мастер «Настройка проектора». Для поддержки сохраните код ошибки. Настройки экранов не изменены."
        }
        alert.informativeText = explanation + "\n\nКод: " + code; alert.runModal()
    }
    func applicationWillTerminate(_ notification: Notification) { if startupLock >= 0 { close(startupLock) } }
}

if CommandLine.arguments.contains("--self-test") {
    try Installation.selfTest()
} else if CommandLine.arguments.contains("--login-status") || CommandLine.arguments.contains("--enable-login") || CommandLine.arguments.contains("--disable-login") {
    guard Installation.isStable(Bundle.main.bundleURL), Bundle.main.bundleIdentifier == Installation.identifier else { FileHandle.standardError.write(Data("STABLE_INSTALL_REQUIRED\n".utf8)); exit(1) }
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
