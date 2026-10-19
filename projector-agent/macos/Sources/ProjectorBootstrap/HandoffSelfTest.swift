import AppKit
import Foundation
import Darwin
import CoreServices

@MainActor final class HandoffFixtureChild: NSObject, NSApplicationDelegate {
    let report: URL
    init(report: URL) { self.report = report.standardizedFileURL }
    static func automaticReport() -> URL? {
        guard Bundle.main.bundleIdentifier?.hasPrefix("ru.university.lecturer-projector.fixture.") == true,
              let path = Bundle.main.object(forInfoDictionaryKey: "LAHandoffFixtureRoot") as? String,
              URL(fileURLWithPath: path).lastPathComponent.hasPrefix("handoff-") else { return nil }
        let role = Bundle.main.bundleURL.path.contains("/IsolatedHome/Applications/") ? "target" : "source"
        return URL(fileURLWithPath: path).appendingPathComponent("automatic-" + role + ".json")
    }
    static func run(report: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = HandoffFixtureChild(report: report); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let data = try? JSONSerialization.data(withJSONObject: ["bundlePath": Bundle.main.bundleURL.standardizedFileURL.path, "pid": ProcessInfo.processInfo.processIdentifier])
        try? data?.write(to: report, options: [.atomic])
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        let fixtureScheme = (Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]])?.first?["CFBundleURLSchemes"] as? [String]
        let normalized: [URL] = urls.compactMap { url in
            if url.scheme == "lecturer-projector" { return url }
            guard let scheme = url.scheme, scheme.hasPrefix("lecture-fixture-"), fixtureScheme?.contains(scheme) == true,
                  var value = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
            value.scheme = "lecturer-projector"; return value.url
        }
        guard normalized.count == urls.count, let request = Installation.pairingRequest(normalized) else { return }
        let mailbox = report.deletingLastPathComponent().appendingPathComponent("FixtureMailbox/" + report.lastPathComponent)
        // The normal URL parser and private request writer, isolated from the real helper mailbox.
        try? Installation.writePairingRequest(request, directory: mailbox)
    }
}

@MainActor final class HandoffSelfTest: NSObject, NSApplicationDelegate {
    let report: URL
    private var owned: [WorkspaceOpened] = []
    private var diagnostics: [String: Any] = [:]
    private var fixtureRoot: URL?
    private var fixtureIdentifier: String?
    init(report: URL) { self.report = report.standardizedFileURL }
    static func run(report: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = HandoffSelfTest(report: report); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            var result: [String: Any]
            var status: Int32 = 0
            do { result = try await exercise() }
            catch BootstrapFailure.code(let code) { result = ["success": false, "code": code]; status = 1 }
            catch { result = ["success": false, "code": "HANDOFF_FIXTURE_FAILED"]; status = 1 }
            if status != 0 { result["diagnostics"] = diagnostics }
            let stopped = await stopOwnedChildren()
            if let root = fixtureRoot, stopped {
                do { try FileManager.default.removeItem(at: root); result["fixtureCleaned"] = true }
                catch { result["fixtureCleaned"] = false; result["success"] = false; status = 1 }
            } else if fixtureRoot != nil { result["fixtureCleaned"] = false; result["success"] = false; status = 1 }
            do {
                let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
                try FileManager.default.createDirectory(at: report.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: report, options: [.atomic]); FileHandle.standardOutput.write(data + Data([10]))
            } catch { exit(2) }
            exit(status)
        }
    }
    private func stopOwnedChildren() async -> Bool {
        if let identifier = fixtureIdentifier, let root = fixtureRoot {
            for app in NSRunningApplication.runningApplications(withBundleIdentifier: identifier) {
                if let path = app.bundleURL?.standardizedFileURL.path, path.hasPrefix(root.path + "/"), !owned.contains(where: { $0.pid == app.processIdentifier }) {
                    owned.append(WorkspaceOpened(pid: app.processIdentifier, bundlePath: path))
                }
            }
        }
        func stillOwned(_ child: WorkspaceOpened) -> NSRunningApplication? {
            guard let app = NSRunningApplication(processIdentifier: child.pid), !app.isTerminated,
                  app.bundleIdentifier == fixtureIdentifier, app.bundleURL?.standardizedFileURL.path == child.bundlePath else { return nil }
            return app
        }
        for child in owned { stillOwned(child)?.terminate() }
        var deadline = Date().addingTimeInterval(3)
        while owned.contains(where: { stillOwned($0) != nil }), Date() < deadline { try? await Task.sleep(for: .milliseconds(50)) }
        // Only a test child matching both its unique fixture ID and original PID/path.
        for child in owned { stillOwned(child)?.forceTerminate() }
        deadline = Date().addingTimeInterval(2)
        while owned.contains(where: { stillOwned($0) != nil }), Date() < deadline { try? await Task.sleep(for: .milliseconds(50)) }
        let stopped = !owned.contains(where: { stillOwned($0) != nil }); if stopped { owned.removeAll() }
        return stopped
    }
    private func exercise() async throws -> [String: Any] {
        // URL.standardizedFileURL folds /private/var back to the /var symlink on macOS.
        // Keep these test apps beside the report in the isolated build workspace so the
        // production no-symlink parent guard is exercised without an OS path alias.
        let id = UUID().uuidString.lowercased()
        let root = report.deletingLastPathComponent().appendingPathComponent(".native-fixtures.noindex/handoff-" + id, isDirectory: true)
        fixtureRoot = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let fakeID = "ru.university.lecturer-projector.fixture." + id; fixtureIdentifier = fakeID
        let scheme = "lecture-fixture-" + id
        let fixtureName = "Native Fixture " + String(id.prefix(8)) + ".app"
        let source = root.appendingPathComponent("Mounted/" + fixtureName)
        let target = root.appendingPathComponent("IsolatedHome/Applications/" + fixtureName)
        try FileManager.default.createDirectory(at: source.appendingPathComponent("Contents/MacOS"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: source.appendingPathComponent("Contents/Resources"), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: Bundle.main.executableURL!, to: source.appendingPathComponent("Contents/MacOS/FixtureBootstrap"))
        let info: [String: Any] = ["CFBundleIdentifier": fakeID, "CFBundleExecutable": "FixtureBootstrap", "CFBundleName": "Native Fixture " + String(id.prefix(8)), "CFBundleDisplayName": "Native Fixture " + String(id.prefix(8)), "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "0.0.1", "LSUIElement": true,
                                   "LAHandoffFixtureRoot": root.path, "CFBundleURLTypes": [["CFBundleURLName": "Isolated native URL fixture", "CFBundleURLSchemes": [scheme], "CFBundleTypeRole": "Viewer"]]]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: source.appendingPathComponent("Contents/Info.plist"))
        #if arch(arm64)
        let platform = "MACOS_ARM64"
        #else
        let platform = "MACOS_X64"
        #endif
        let metadata: [String: Any] = ["version": "0.0.1", "platform": platform, "entryPoint": "Lecturer Projector Host.app/Contents/MacOS/ProjectorMac", "packageSha256": String(repeating: "a", count: 64), "packageSize": 1, "minimumOsVersion": "14.0", "protocolVersion": 1]
        try JSONSerialization.data(withJSONObject: metadata).write(to: source.appendingPathComponent("Contents/Resources/bootstrap.json"))
        let sign = Process(); sign.executableURL = URL(fileURLWithPath: "/usr/bin/codesign"); sign.arguments = ["--force", "--sign", "-", source.path]
        sign.standardOutput = FileHandle.nullDevice; sign.standardError = FileHandle.nullDevice; try sign.run(); sign.waitUntilExit()
        guard sign.terminationStatus == 0 else { throw BootstrapFailure.code("HANDOFF_FIXTURE_SIGNING") }
        // Copy the app just as the installer does; do not launch from the source bundle again.
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: source, to: target)
        let sourceIdentity = try? Installation.codeIdentity(source), targetIdentity = try? Installation.codeIdentity(target)
        diagnostics = ["expectedIdentifier": fakeID, "sourceIdentifier": Bundle(url: source)?.bundleIdentifier ?? "missing",
                       "targetIdentifier": Bundle(url: target)?.bundleIdentifier ?? "missing",
                       "sourceVersion": Bundle(url: source)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "missing",
                       "targetVersion": Bundle(url: target)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "missing",
                       "sourceIdentityVerified": sourceIdentity != nil, "targetIdentityVerified": targetIdentity != nil,
                       "nativeIdentityEqual": sourceIdentity != nil && sourceIdentity == targetIdentity,
                       "sourcePath": source.path, "targetPath": target.path]
        let match = try Installation.installedMatch(runningBundle: source, candidates: [target], expectedIdentifier: fakeID)
        guard let match else { throw BootstrapFailure.code("HANDOFF_FIXTURE_NO_IDENTITY_MATCH") }
        diagnostics["matchedPath"] = match.path
        // Foundation releases differ in preserving a directory URL's trailing slash.
        // The security decision above is independent; compare canonical filesystem paths.
        guard match.path == target.standardizedFileURL.path else { throw BootstrapFailure.code("HANDOFF_FIXTURE_CANONICAL_PATH") }
        let alternate = root.appendingPathComponent("SharedApplications/" + fixtureName)
        try FileManager.default.createDirectory(at: alternate.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: target, to: alternate)
        do { _ = try Installation.installedMatch(runningBundle: source, candidates: [target, alternate], expectedIdentifier: fakeID); throw BootstrapFailure.code("HANDOFF_FIXTURE_AMBIGUITY_MISSED") }
        catch BootstrapFailure.code(let code) { guard code == "MULTIPLE_MATCHING_INSTALLATIONS" else { throw BootstrapFailure.code(code) } }
        try FileManager.default.removeItem(at: alternate)
        guard await WorkspaceHandoff.backgroundCallbackFixture() else { throw BootstrapFailure.code("HANDOFF_FIXTURE_BACKGROUND_CALLBACK") }
        let sourceChild = try await WorkspaceHandoff.open(target: source, arguments: ["--handoff-fixture-child", root.appendingPathComponent("source-started.json").path]); owned.append(sourceChild)
        let pairURL = URL(string: "lecturer-projector://pair?origin=https%3A%2F%2Fschool.example%2F&code=A1B2C3D4E5F6")!
        let targetChild = try await WorkspaceHandoff.open(target: target, arguments: ["--handoff-fixture-child", root.appendingPathComponent("target-started.json").path], urls: [pairURL]); owned.append(targetChild)
        guard targetChild.bundlePath == target.path, targetChild.pid != sourceChild.pid else { throw BootstrapFailure.code("HANDOFF_FIXTURE_EXACT_TARGET") }
        let deadline = Date().addingTimeInterval(10)
        while !FileManager.default.fileExists(atPath: root.appendingPathComponent("target-started.json").path), Date() < deadline { try await Task.sleep(for: .milliseconds(50)) }
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("target-started.json").path) else { throw BootstrapFailure.code("HANDOFF_FIXTURE_CHILD_START") }
        let pair = root.appendingPathComponent("FixtureMailbox/target-started.json/pending-pair.json")
        while !FileManager.default.fileExists(atPath: pair.path), Date() < deadline { try await Task.sleep(for: .milliseconds(50)) }
        guard let bytes = try? Data(contentsOf: pair), let request = try? JSONSerialization.jsonObject(with: bytes) as? [String: String],
              request["code"] == "A1B2C3D4E5F6", request["origin"] == "https://school.example/",
              let mode = try FileManager.default.attributesOfItem(atPath: pair.path)[.posixPermissions] as? NSNumber, mode.intValue == 0o600 else { throw BootstrapFailure.code("HANDOFF_FIXTURE_PAIR_DELIVERY") }
        guard await stopOwnedChildren() else { throw BootstrapFailure.code("HANDOFF_FIXTURE_CHILD_STOP") }
        // Reproduce an already mounted legacy 0.2.1 handler during a 0.2.2 upgrade.
        // Mutate only this random test scheme, never lecturer-projector or another app's scheme.
        func setFixtureVersion(_ app: URL, _ version: String) throws {
            let infoURL = app.appendingPathComponent("Contents/Info.plist")
            var value = try PropertyListSerialization.propertyList(from: Data(contentsOf: infoURL), format: nil) as! [String: Any]
            value["CFBundleShortVersionString"] = version; value["CFBundleVersion"] = version
            try PropertyListSerialization.data(fromPropertyList: value, format: .xml, options: 0).write(to: infoURL)
            let metadataURL = app.appendingPathComponent("Contents/Resources/bootstrap.json")
            var meta = try JSONSerialization.jsonObject(with: Data(contentsOf: metadataURL)) as! [String: Any]; meta["version"] = version
            try JSONSerialization.data(withJSONObject: meta).write(to: metadataURL)
            _ = try Installation.run(URL(fileURLWithPath: "/usr/bin/codesign"), ["--force", "--sign", "-", app.path])
        }
        try setFixtureVersion(source, "0.2.1")
        diagnostics["registrationStage"] = "competing-source"
        do { try await PairingURLRegistration.select(target: source, scheme: scheme) }
        catch { diagnostics["selectedFixturePath"] = NSWorkspace.shared.urlForApplication(toOpen: URL(string: scheme + "://pair")!)?.path ?? "none"; throw error }
        try setFixtureVersion(target, "0.2.2")
        let installer = root.appendingPathComponent("Mounted/Install Native Fixture " + String(id.prefix(8)) + ".app")
        try FileManager.default.copyItem(at: target, to: installer)
        let installerInfo = installer.appendingPathComponent("Contents/Info.plist")
        var installerValues = try PropertyListSerialization.propertyList(from: Data(contentsOf: installerInfo), format: nil) as! [String: Any]
        installerValues["CFBundleIdentifier"] = fakeID + ".installer"; installerValues.removeValue(forKey: "CFBundleURLTypes")
        installerValues["CFBundleName"] = "Install Native Fixture " + String(id.prefix(8)); installerValues["CFBundleDisplayName"] = installerValues["CFBundleName"]
        try PropertyListSerialization.data(fromPropertyList: installerValues, format: .xml, options: 0).write(to: installerInfo)
        _ = try Installation.run(URL(fileURLWithPath: "/usr/bin/codesign"), ["--force", "--sign", "-", installer.path])
        guard LSRegisterURL(installer as CFURL, true) == noErr else { throw BootstrapFailure.code("HANDOFF_FIXTURE_OUTER_REGISTRATION") }
        diagnostics["registrationStage"] = "canonical-target"
        do { try await PairingURLRegistration.select(target: target, scheme: scheme) }
        catch { diagnostics["selectedFixturePath"] = NSWorkspace.shared.urlForApplication(toOpen: URL(string: scheme + "://pair")!)?.path ?? "none"; throw error }
        let genericURL = URL(string: scheme + "://pair?origin=https%3A%2F%2Fschool.example%2F&code=D1S2P3A4T5C6")!
        guard NSWorkspace.shared.open(genericURL) else { throw BootstrapFailure.code("HANDOFF_FIXTURE_GENERIC_DISPATCH") }
        let automatic = root.appendingPathComponent("automatic-target.json")
        let automaticPair = root.appendingPathComponent("FixtureMailbox/automatic-target.json/pending-pair.json")
        let dispatchDeadline = Date().addingTimeInterval(15)
        while !FileManager.default.fileExists(atPath: automaticPair.path), Date() < dispatchDeadline { try await Task.sleep(for: .milliseconds(50)) }
        guard let started = try? JSONSerialization.jsonObject(with: Data(contentsOf: automatic)) as? [String: Any],
              started["bundlePath"] as? String == target.path,
              let request = try? JSONSerialization.jsonObject(with: Data(contentsOf: automaticPair)) as? [String: String],
              request["code"] == "D1S2P3A4T5C6" else { throw BootstrapFailure.code("HANDOFF_FIXTURE_GENERIC_TARGET_DELIVERY") }
        return ["success": true, "initialCopyThenOpen": true, "sourceAndTargetHaveSameFixtureBundleID": true, "exactTargetPath": true, "distinctProcesses": true,
                "nonisolatedBackgroundCompletion": true, "nativeArchitectureCDHashMatch": true, "ambiguousCanonicalCopiesRejected": true,
                "sourceAndCanonicalHandlersCompeted": true, "genericURLDispatchToCanonical": true, "productionSchemeChanged": false,
                "legacyHandlerVersion": "0.2.1", "canonicalHandlerVersion": "0.2.2", "newInstallerHasDistinctIDAndNoClaims": true,
                "pairRequestDeliveredToExactTarget": true, "pairRequestIsolated": true, "fixtureRoot": root.path, "userInstallationChanged": false, "quarantineChanged": false, "privateAPIsUsed": false, "keychainChanged": false, "networkUsed": false, "displaySettingsChanged": false]
    }
}
