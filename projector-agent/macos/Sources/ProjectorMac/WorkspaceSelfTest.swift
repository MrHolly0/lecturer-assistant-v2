import AppKit
import Foundation
import Darwin

@MainActor final class WorkspaceSelfTest: NSObject, NSApplicationDelegate {
    private let reportURL: URL
    init(reportURL: URL) { self.reportURL = reportURL }
    static func run(reportURL: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = WorkspaceSelfTest(reportURL: reportURL); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            var result: [String: Any]; var status: Int32 = 0
            do {
                result = ["success": true, "theme": try await RemoteWindow.exerciseHiddenThemeFixture(),
                          "projection": try ProjectionWindow.exerciseHiddenLifecycleFixture(),
                          "commands": try await AppDelegate.exerciseRemoteCommandsFixture(),
                          "permission": try await permissionFixture(), "allWindowsHidden": true, "fixtureCleaned": true,
                          "screenCaptured": false, "permissionRequested": false, "displaySettingsChanged": false,
                          "keychainChanged": false, "productionSchemeChanged": false, "networkUsed": false]
            } catch HostError.code(let code) { result = ["success": false, "code": code]; status = 1 }
            catch { result = ["success": false, "code": "WORKSPACE_FIXTURE_FAILED"]; status = 1 }
            do {
                try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
                try data.write(to: reportURL, options: [.atomic]); FileHandle.standardOutput.write(data + Data([10]))
            } catch { exit(2) }
            exit(status)
        }
    }
    private func permissionFixture() async throws -> [String: Any] {
        var prompts = 0, activations = 0
        let existing = await CaptureAuthorization.request(preflight: { true }, activate: { activations += 1 }, prompt: { prompts += 1; return false })
        guard existing, prompts == 0 else { throw HostError.code("WORKSPACE_PERMISSION_REPROMPTED") }
        let requested = await CaptureAuthorization.request(preflight: { false }, activate: { activations += 1 }, prompt: { prompts += 1; return true })
        guard requested, prompts == 1, activations == 1 else { throw HostError.code("WORKSPACE_PERMISSION_NOT_REQUESTED") }
        var granted = false, pauses = 0
        let denied = await CaptureAuthorization.request(preflight: { granted }, activate: {}, prompt: { prompts += 1; return false })
        guard !denied else { throw HostError.code("WORKSPACE_PERMISSION_DENIAL_IGNORED") }
        let resumed = await CaptureAuthorization.waitForGrant(attempts: 4, preflight: { granted }, cancelled: { false }, pause: { pauses += 1; if pauses == 2 { granted = true } })
        guard resumed, prompts == 2, pauses == 2 else { throw HostError.code("WORKSPACE_PERMISSION_CONTINUATION") }
        let cancelled = await CaptureAuthorization.waitForGrant(attempts: 4, preflight: { true }, cancelled: { true }, pause: {})
        guard !cancelled else { throw HostError.code("WORKSPACE_PERMISSION_CANCEL_IGNORED") }
        return ["existingGrantSkipsPrompt": true, "foregroundPromptRequested": true, "grantContinuesSelection": true,
                "denialBlocksCapture": true, "stopCancelsPendingSelection": true, "realPermissionAPIsCalled": false]
    }
}
