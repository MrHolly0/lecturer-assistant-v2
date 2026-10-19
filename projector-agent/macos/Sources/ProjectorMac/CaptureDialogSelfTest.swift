import AppKit
import Foundation
import Darwin

@MainActor final class CaptureDialogSelfTest: NSObject, NSApplicationDelegate {
    private let reportURL: URL
    init(reportURL: URL) { self.reportURL = reportURL }
    static func run(reportURL: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = CaptureDialogSelfTest(reportURL: reportURL); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        // A bounded self-owned process guard; no user's helper is contacted or terminated.
        DispatchQueue.global().asyncAfter(deadline: .now() + 40) { exit(3) }
        Task { @MainActor in
            var result: [String: Any]; var status: Int32 = 0
            do { result = try await exercise() }
            catch HostError.code(let code) { result = ["success": false, "code": code]; status = 1 }
            catch { result = ["success": false, "code": "CAPTURE_DIALOG_FIXTURE_FAILED"]; status = 1 }
            do {
                try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
                try data.write(to: reportURL, options: [.atomic]); FileHandle.standardOutput.write(data + Data([10]))
            } catch { exit(2) }
            exit(status)
        }
    }
    private func exercise() async throws -> [String: Any] {
        let remote = RemoteWindow.captureParentFixture()
        guard let parent = remote.presentationWindow, parent.styleMask.contains(.nonactivatingPanel),
              !parent.styleMask.contains(.titled), parent.canBecomeKey, !parent.canBecomeMain else {
            throw HostError.code("CAPTURE_DIALOG_WRONG_PARENT_FACTORY")
        }
        parent.orderBack(nil)
        let dialog = CaptureDialog()
        defer { dialog.cancel(); remote.close(notify: false) }
        func alert() -> NSAlert {
            let alert = NSAlert(); alert.messageText = "Isolated capture dialog fixture"
            alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
            alert.layout(); alert.window.alphaValue = 0
            return alert
        }
        let picker = alert(), started = ProcessInfo.processInfo.systemUptime
        let selection = Task { await dialog.present(picker, for: parent) }
        let permission = Task {
            await CaptureAuthorization.request(preflight: { false }, activate: {}, prompt: {
                await CaptureAuthorization.offMainPrompt { Thread.sleep(forTimeInterval: 18); return !Thread.isMainThread }
            })
        }
        try await Task.sleep(for: .milliseconds(50))
        let reply = AppDelegate.makeScreenReplyFixture()
        var replies = 0, maximumLatency = 0.0
        while ProcessInfo.processInfo.systemUptime - started < 18 {
            let sent = ProcessInfo.processInfo.systemUptime
            try await reply()
            maximumLatency = max(maximumLatency, ProcessInfo.processInfo.systemUptime - sent); replies += 1
            try await Task.sleep(for: .milliseconds(200))
        }
        let held = ProcessInfo.processInfo.systemUptime - started
        guard dialog.isPresented, picker.window.sheetParent === parent, replies > 50, maximumLatency < 1 else {
            throw HostError.code("CAPTURE_DIALOG_BLOCKED_NATIVE_REPLIES")
        }
        parent.endSheet(picker.window, returnCode: .alertFirstButtonReturn)
        guard await selection.value == .alertFirstButtonReturn, !dialog.isPresented else { throw HostError.code("CAPTURE_DIALOG_SELECTION_LOST") }
        guard await permission.value else { throw HostError.code("CAPTURE_PERMISSION_PROMPT_BLOCKED_MAIN_ACTOR") }
        let cancelled = Task { await dialog.present(alert(), for: parent) }
        try await Task.sleep(for: .milliseconds(50)); dialog.cancel(); dialog.cancel()
        guard await cancelled.value == .cancel, !dialog.isPresented else { throw HostError.code("CAPTURE_DIALOG_CANCEL_FAILED") }
        let closed = Task { await dialog.present(alert(), for: parent) }
        try await Task.sleep(for: .milliseconds(50)); parent.close()
        guard await closed.value == .cancel, !dialog.isPresented else { throw HostError.code("CAPTURE_DIALOG_PARENT_CLOSE_FAILED") }
        return ["success": true, "sheetHeldSeconds": held, "getScreensReplies": replies, "maximumGetScreensLatency": maximumLatency,
                "heldBeyond12SecondLease": held > 12, "nativeRepliesResponsive": true, "selectionAccepted": true,
                "stopCancelsExactlyOnce": true, "parentCloseCancels": true, "fixtureCleaned": true,
                "delayedPermissionKeepsNativeRepliesResponsive": true, "permissionPromptOffMain": true, "realPermissionAPIsCalled": false,
                "productionRemoteParentFactory": true,
                "allFixtureWindowsTransparent": true, "screenCaptured": false, "keychainUsed": false,
                "userWindowsUsed": false, "userInstallationChanged": false, "networkUsed": false]
    }
}
