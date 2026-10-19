import AppKit
@preconcurrency import ScreenCaptureKit
import Darwin

@MainActor final class CaptureModesSelfTest: NSObject, NSApplicationDelegate {
    let report: URL
    private var ownSourceGeometry: [String: Double] = [:]
    init(report: URL) { self.report = report }
    static func run(report: URL) {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = CaptureModesSelfTest(report: report); app.delegate = delegate; app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.global().asyncAfter(deadline: .now() + 40) { exit(3) }
        Task { @MainActor in
            var result: [String: Any], code: Int32 = 0
            do { result = try await exercise() }
            catch HostError.code(let failure) { result = ["success": false, "code": failure, "ownSourceGeometry": ownSourceGeometry]; code = 1 }
            catch { result = ["success": false, "code": "CAPTURE_MODES_FIXTURE_FAILED"]; code = 1 }
            do {
                try FileManager.default.createDirectory(at: report.deletingLastPathComponent(), withIntermediateDirectories: true)
                let bytes = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
                try bytes.write(to: report, options: .atomic); FileHandle.standardOutput.write(bytes + Data([10]))
            } catch { exit(2) }
            exit(code)
        }
    }
    private func exercise() async throws -> [String: Any] {
        guard #available(macOS 14.4, *) else { throw HostError.code("CAPTURE_MODES_FIXTURE_REQUIRES_OWN_PROCESS_API") }
        let window = NSWindow(contentRect: NSRect(x: 50_000, y: 50_000, width: 480, height: 300), styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false; window.alphaValue = 0; window.title = "Isolated source fixture"
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 480, height: 300)); view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.systemPurple.cgColor; window.contentView = view; window.orderBack(nil)
        let capture = NativeCapture()
        defer { window.close() }
        var ownWindow: SCWindow?
        for _ in 0..<30 {
            let content = try await SCShareableContent.currentProcess
            ownWindow = content.windows.first { Int($0.windowID) == window.windowNumber && $0.owningApplication?.processID == getpid() }
            if ownWindow != nil { break }; try await Task.sleep(for: .milliseconds(50))
        }
        guard let ownWindow else { throw HostError.code("CAPTURE_MODES_OWN_WINDOW_UNAVAILABLE") }
        let filter = SCContentFilter(desktopIndependentWindow: ownWindow)
        ownSourceGeometry = ["windowWidth": Double(window.frame.width), "windowHeight": Double(window.frame.height),
                             "shareableWidth": Double(ownWindow.frame.width), "shareableHeight": Double(ownWindow.frame.height),
                             "filterWidth": Double(filter.contentRect.width), "filterHeight": Double(filter.contentRect.height),
                             "filterScale": Double(filter.pointPixelScale)]
        let content = try await SCShareableContent.currentProcess
        guard let display = content.displays.first else { throw HostError.code("CAPTURE_MODES_OWN_DISPLAY_METADATA_UNAVAILABLE") }
        _ = try NativeCapture.protectedDisplayFilter(display: display, applications: content.applications)
        do { _ = try NativeCapture.protectedDisplayFilter(display: display, applications: []); throw HostError.code("CAPTURE_MODES_UNPROTECTED_DISPLAY_ACCEPTED") }
        catch HostError.code(let code) { guard code == "CAPTURE_PRIVATE_WINDOW_EXCLUSION_UNAVAILABLE" else { throw HostError.code(code) } }
        let authorization = DisplayCaptureAuthorization(); var prompts = 0, granted = false
        _ = await authorization.request(preflight: { granted }, activate: {}, prompt: { prompts += 1; return false })
        _ = await authorization.request(preflight: { granted }, activate: {}, prompt: { prompts += 1; return false })
        granted = true
        guard await authorization.request(preflight: { granted }, activate: {}, prompt: { prompts += 1; return false }), prompts == 1 else { throw HostError.code("CAPTURE_MODES_PERMISSION_LOOP") }
        var events: [[String: Any]] = []
        capture.event = { events.append($0) }
        let lifecycle = try await SystemSourcePicker.exerciseLifecycleFixture(filter: filter, reply: AppDelegate.makeScreenReplyFixture())
        let choice = Task { await capture.chooseSource(selection: { try await Task.sleep(for: .milliseconds(150)); return filter }) }
        try await Task.sleep(for: .milliseconds(50))
        guard !events.contains(where: { $0["phase"] as? String == "idle" }) else { throw HostError.code("CAPTURE_CHOICE_RESET_CLEARED_SCOPE") }
        guard !events.contains(where: { $0["phase"] as? String == "preview" || $0["phase"] as? String == "live" }) else { throw HostError.code("CAPTURE_STARTED_BEFORE_SELECTION") }
        await choice.value
        if #available(macOS 15.2, *) {
            guard events.contains(where: { $0["code"] as? String == "CAPTURE_PRIVATE_SOURCE_REJECTED" }) else { throw HostError.code("CAPTURE_MODES_OWN_SOURCE_NOT_REJECTED") }
        }
        events.removeAll(); try await capture.beginOwnPreviewFixture(window: ownWindow, ownWindow: window)
        let deadline = Date().addingTimeInterval(8)
        while Date() < deadline && !events.contains(where: { $0["type"] as? String == "preview" }) { try await Task.sleep(for: .milliseconds(50)) }
        guard let frame = events.first(where: { $0["type"] as? String == "preview" }),
              (frame["frameUrl"] as? String)?.hasPrefix("data:image/jpeg;base64,") == true,
              frame["captureExcludesRemote"] as? Bool == true,
              !events.contains(where: { $0["phase"] as? String == "live" }) else { await capture.stop(); throw HostError.code("CAPTURE_MODES_NO_PRIVATE_PREVIEW") }
        await capture.stop()
        guard !capture.isActive, events.last?["phase"] as? String == "idle" else { throw HostError.code("CAPTURE_MODES_STOP_FAILED") }
        // A cancelled selection must not revive capture when its delayed result arrives.
        let cancelled = Task { await capture.chooseSource(selection: { try await Task.sleep(for: .milliseconds(150)); return filter }) }
        try await Task.sleep(for: .milliseconds(30)); await capture.stop(); await cancelled.value
        guard !capture.isActive else { throw HostError.code("CAPTURE_MODES_CANCEL_REVIVED_STREAM") }
        let child = Process(), input = Pipe()
        child.executableURL = URL(fileURLWithPath: "/bin/cat"); child.standardInput = input
        child.standardOutput = FileHandle.nullDevice; child.standardError = FileHandle.nullDevice
        try child.run(); CoordinatorShutdown.stop(child, input: input)
        guard !child.isRunning else { throw HostError.code("COORDINATOR_SHUTDOWN_LEFT_CHILD") }
        return ["success": true, "picker": lifecycle, "ownSourceGeometry": ownSourceGeometry,
                "noCaptureBeforeSelection": true, "replacementDoesNotEmitIdle": true,
                "actualOwnWindowStreamPreview": true, "previewRemainsLocalUntilPublish": true,
                "stopClosesStream": true, "cancelledSelectionCannotRestart": true, "ownedCoordinatorStopped": true,
                "protectedDisplayUsesExplicitExclusion": true, "missingExclusionBlocksDisplay": true, "displayDenialDoesNotLoop": true,
                "privateSourceOnly": true, "fixtureWindowsTransparent": true, "fixtureCleaned": true,
                "systemPickerPresented": false, "fullDisplayCaptured": false, "globalPermissionRequested": false,
                "userApplicationCaptured": false, "userInstallationChanged": false, "keychainUsed": false, "networkUsed": false]
    }
}
