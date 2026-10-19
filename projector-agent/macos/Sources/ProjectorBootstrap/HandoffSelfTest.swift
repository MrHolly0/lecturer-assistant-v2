import AppKit
import Foundation
import Darwin

@MainActor final class HandoffFixtureChild: NSObject, NSApplicationDelegate {
    let report: URL
    init(report: URL) { self.report = report.standardizedFileURL }
    static func run(report: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = HandoffFixtureChild(report: report); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let data = try? JSONSerialization.data(withJSONObject: ["bundlePath": Bundle.main.bundleURL.standardizedFileURL.path, "pid": ProcessInfo.processInfo.processIdentifier])
        try? data?.write(to: report, options: [.atomic])
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let request = Installation.pairingRequest(urls) else { return }
        let mailbox = report.deletingLastPathComponent().appendingPathComponent("FixtureMailbox/" + report.lastPathComponent)
        // The normal URL parser and private request writer, isolated from the real helper mailbox.
        try? Installation.writePairingRequest(request, directory: mailbox)
    }
}

@MainActor final class HandoffSelfTest: NSObject, NSApplicationDelegate {
    let report: URL
    private var owned: [WorkspaceOpened] = []
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
            for child in owned {
                if let app = NSRunningApplication(processIdentifier: child.pid), app.bundleURL?.standardizedFileURL.path == child.bundlePath { app.terminate() }
            }
            do {
                let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
                try FileManager.default.createDirectory(at: report.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: report, options: [.atomic]); FileHandle.standardOutput.write(data + Data([10]))
            } catch { exit(2) }
            exit(status)
        }
    }
    private func exercise() async throws -> [String: Any] {
        // URL.standardizedFileURL folds /private/var back to the /var symlink on macOS.
        // Keep these test apps beside the report in the isolated build workspace so the
        // production no-symlink parent guard is exercised without an OS path alias.
        let root = report.deletingLastPathComponent().appendingPathComponent("lecturer-handoff-fixture-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let fakeID = "ru.university.lecturer-projector.fixture." + UUID().uuidString.lowercased()
        let source = root.appendingPathComponent("Mounted/Lecturer Projector.app")
        let target = root.appendingPathComponent("IsolatedHome/Applications/Lecturer Projector.app")
        try FileManager.default.createDirectory(at: source.appendingPathComponent("Contents/MacOS"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: source.appendingPathComponent("Contents/Resources"), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: Bundle.main.executableURL!, to: source.appendingPathComponent("Contents/MacOS/FixtureBootstrap"))
        let info: [String: Any] = ["CFBundleIdentifier": fakeID, "CFBundleExecutable": "FixtureBootstrap", "CFBundleName": "Lecturer Handoff Fixture", "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "0.0.1", "LSUIElement": true]
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
        let match = try Installation.installedMatch(runningBundle: source, candidates: [target], expectedIdentifier: fakeID)
        guard match == target else { throw BootstrapFailure.code("HANDOFF_FIXTURE_CANONICAL_MATCH") }
        let alternate = root.appendingPathComponent("SharedApplications/Lecturer Projector.app")
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
        return ["success": true, "initialCopyThenOpen": true, "sourceAndTargetHaveSameFixtureBundleID": true, "exactTargetPath": true, "distinctProcesses": true,
                "nonisolatedBackgroundCompletion": true, "nativeArchitectureCDHashMatch": true, "ambiguousCanonicalCopiesRejected": true,
                "pairRequestDeliveredToExactTarget": true, "pairRequestIsolated": true, "fixtureRoot": root.path, "userInstallationChanged": false, "quarantineChanged": false, "privateAPIsUsed": false, "keychainChanged": false, "networkUsed": false, "displaySettingsChanged": false]
    }
}
